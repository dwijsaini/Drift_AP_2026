import { Prisma } from '@prisma/client';
import { prisma } from './db.js';

/**
 * Granularity string to Prisma SQL fragment mapping.
 * Used in date_trunc calls within the summary query.
 */
export const SUMMARY_GRANULARITY = {
  daily:   Prisma.sql`'day'`,
  weekly:  Prisma.sql`'week'`,
  monthly: Prisma.sql`'month'`,
};

/**
 * Fetch aggregated energy summaries for a building, grouped by time bucket.
 *
 * The caller must have already verified membership and validated parameters.
 * Raw SQL is used because Prisma ORM cannot express date_trunc or AT TIME ZONE
 * aggregations natively.
 *
 * @param {bigint} buildingId   Building to query
 * @param {bigint} userId       User performing query (membership check in SQL)
 * @param {Prisma.Sql} unit     Prisma.sql fragment: 'day', 'week', or 'month'
 * @param {Date}   from         Inclusive start of query window
 * @param {Date}   to           Exclusive end of query window
 * @returns {Promise<Array>}    One row per time bucket with energy metrics
 */
export async function getEnergySummary(buildingId, userId, unit, from, to) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH accessible_building AS (
      SELECT b.building_id, b.timezone
      FROM building_members bm
      JOIN buildings b ON b.building_id = bm.building_id
      WHERE bm.user_id = ${userId} AND b.building_id = ${buildingId}
    ), calendar AS (
      SELECT ab.building_id, ab.timezone, bucket.local_start,
             bucket.local_start + CASE ${unit}
               WHEN 'day' THEN interval '1 day'
               WHEN 'week' THEN interval '7 days'
               WHEN 'month' THEN interval '1 month'
             END AS local_end
      FROM accessible_building ab
      CROSS JOIN LATERAL generate_series(
        date_trunc(${unit}, ${from} AT TIME ZONE ab.timezone),
        date_trunc(${unit}, (${to} - interval '1 microsecond') AT TIME ZONE ab.timezone),
        CASE ${unit}
          WHEN 'day' THEN interval '1 day'
          WHEN 'week' THEN interval '7 days'
          WHEN 'month' THEN interval '1 month'
        END
      ) AS bucket(local_start)
    ), aggregate_readings AS (
      SELECT date_trunc(${unit}, ep.period_start AT TIME ZONE ab.timezone) AS local_start,
             ab.building_id,
             sum(ep.generated_kwh) AS generated_kwh,
             sum(ep.consumed_kwh) AS consumed_kwh,
             sum(ep.generated_kwh - ep.consumed_kwh) AS energy_balance_kwh,
             sum(ep.consumed_kwh - ep.generated_kwh) AS energy_gap_kwh,
             sum(ep.grid_import_kwh) AS grid_import_kwh,
             count(ep.reading_id) AS reading_count,
             count(ep.grid_import_kwh) AS grid_import_reading_count
      FROM accessible_building ab
      JOIN energy_periods ep ON ep.building_id = ab.building_id
      WHERE ep.period_start >= ${from} AND ep.period_start < ${to}
      GROUP BY 1, 2
    )
    SELECT c.local_start::date AS "periodStart", c.local_end::date AS "periodEnd",
           c.timezone AS "timezone",
           coalesce(a.generated_kwh, 0) AS "generatedKwh",
           coalesce(a.consumed_kwh, 0) AS "consumedKwh",
           coalesce(a.energy_balance_kwh, 0) AS "energyBalanceKwh",
           coalesce(a.energy_gap_kwh, 0) AS "energyGapKwh",
           CASE WHEN coalesce(a.consumed_kwh, 0) = 0 THEN NULL
                ELSE round(100 * least(a.generated_kwh, a.consumed_kwh) / a.consumed_kwh, 2)
           END AS "solarCoveragePct",
           a.grid_import_kwh AS "gridImportKwh",
           coalesce(a.reading_count, 0) AS "readingCount",
           coalesce(a.grid_import_reading_count, 0) AS "gridImportReadingCount",
           (SELECT count(*) FROM generate_series(
              c.local_start AT TIME ZONE c.timezone,
              (c.local_end AT TIME ZONE c.timezone) - interval '1 hour', interval '1 hour'
            ) AS slot(hour_start)
            WHERE slot.hour_start >= ${from} AND slot.hour_start < ${to}) AS "expectedReadingCount"
    FROM calendar c
    LEFT JOIN aggregate_readings a
      ON a.building_id = c.building_id AND a.local_start = c.local_start
    ORDER BY c.local_start`);

  return rows.map(withCompleteness);
}

/** Add stable completeness fields without changing the existing hasGap contract. */
export function withCompleteness(row) {
  const readingCount = Number(row.readingCount);
  const expectedReadingCount = Number(row.expectedReadingCount);
  const missingPeriodCount = Math.max(expectedReadingCount - readingCount, 0);
  return { ...row, readingCount, expectedReadingCount, missingPeriodCount, hasGap: missingPeriodCount > 0 };
}

/** Query-time comparison of each building visible to a member over one UTC range. */
export async function getBuildingComparison(userId, from, to) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH accessible_buildings AS (
      SELECT b.building_id, b.name, b.timezone
      FROM building_members bm JOIN buildings b ON b.building_id = bm.building_id
      WHERE bm.user_id = ${userId}
    ), daily_slots AS (
      SELECT ab.building_id, slots.hour_start
      FROM accessible_buildings ab
      CROSS JOIN LATERAL generate_series(
        date_trunc('day', ${from} AT TIME ZONE ab.timezone) AT TIME ZONE ab.timezone,
        ((date_trunc('day', (${to} - interval '1 microsecond') AT TIME ZONE ab.timezone)
          + interval '1 day') AT TIME ZONE ab.timezone) - interval '1 hour',
        interval '1 hour'
      ) AS slots(hour_start)
      WHERE slots.hour_start >= ${from} AND slots.hour_start < ${to}
    ), expected AS (
      SELECT building_id, count(*) AS expected_reading_count
      FROM daily_slots GROUP BY building_id
    ), totals AS (
      SELECT ab.building_id, ab.name, ab.timezone,
             coalesce(sum(ep.generated_kwh), 0) AS generated_kwh,
             coalesce(sum(ep.consumed_kwh), 0) AS consumed_kwh,
             coalesce(sum(ep.generated_kwh - ep.consumed_kwh), 0) AS energy_balance_kwh,
             sum(ep.grid_import_kwh) AS grid_import_kwh,
             count(ep.reading_id) AS reading_count,
             count(ep.grid_import_kwh) AS grid_import_reading_count
      FROM accessible_buildings ab
      LEFT JOIN energy_periods ep ON ep.building_id = ab.building_id
        AND ep.period_start >= ${from} AND ep.period_start < ${to}
      GROUP BY ab.building_id, ab.name, ab.timezone
    )
    SELECT t.building_id AS "buildingId", t.name AS "buildingName", t.timezone,
           t.generated_kwh AS "generatedKwh", t.consumed_kwh AS "consumedKwh",
           t.energy_balance_kwh AS "energyBalanceKwh",
           t.consumed_kwh - t.generated_kwh AS "energyGapKwh",
           CASE WHEN t.consumed_kwh = 0 THEN NULL
                ELSE round(100 * least(t.generated_kwh, t.consumed_kwh) / t.consumed_kwh, 2)
           END AS "solarCoveragePct",
           t.grid_import_kwh AS "gridImportKwh",
           t.reading_count AS "readingCount",
           t.grid_import_reading_count AS "gridImportReadingCount",
           coalesce(e.expected_reading_count, 0) AS "expectedReadingCount"
    FROM totals t LEFT JOIN expected e ON e.building_id = t.building_id
    ORDER BY t.name, t.building_id`);
  return rows.map(withCompleteness);
}

/** Estimate INR cost from the recorded grid import only; null when unavailable. */
export function estimateGridCost(gridImportKwh, electricityRateInrPerKwh) {
  if (gridImportKwh === null || gridImportKwh === undefined || electricityRateInrPerKwh === undefined) return null;
  return new Prisma.Decimal(gridImportKwh.toString())
    .mul(new Prisma.Decimal(electricityRateInrPerKwh.toString()))
    .toDecimalPlaces(2)
    .toFixed(2);
}

/**
 * Pure utility — compute derived energy metrics from raw generation and
 * consumption totals. No database calls; can be used in tests or the UI.
 *
 * Formula reference (also documented in docs/api.md):
 *   balance = generated - consumed  (negative means more was consumed than generated)
 *   gap     = consumed  - generated  (positive means deficit; gap === -balance)
 *   coverage = min(generated, consumed) / consumed × 100
 *              (null when consumed is zero; implicitly capped at 100 % by min())
 *
 * @param {number} generatedKwh
 * @param {number} consumedKwh
 * @returns {{ balanceKwh: number, gapKwh: number, solarCoveragePct: number|null }}
 */
export function computeEnergyMetrics(generatedKwh, consumedKwh) {
  const balanceKwh = generatedKwh - consumedKwh;
  const gapKwh     = consumedKwh  - generatedKwh;
  const solarCoveragePct =
    consumedKwh === 0
      ? null
      : Math.min(generatedKwh, consumedKwh) / consumedKwh * 100;
  return { balanceKwh, gapKwh, solarCoveragePct };
}
