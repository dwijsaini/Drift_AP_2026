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
    SELECT
      date_trunc(${unit}, ep.period_start AT TIME ZONE b.timezone)::date AS "periodStart",
      CASE ${unit}
        WHEN 'day'   THEN (date_trunc('day',   ep.period_start AT TIME ZONE b.timezone) + interval '1 day')::date
        WHEN 'week'  THEN (date_trunc('week',  ep.period_start AT TIME ZONE b.timezone) + interval '7 days')::date
        WHEN 'month' THEN (date_trunc('month', ep.period_start AT TIME ZONE b.timezone) + interval '1 month')::date
      END AS "periodEnd",
      b.timezone AS "timezone",
      sum(ep.generated_kwh)                           AS "generatedKwh",
      sum(ep.consumed_kwh)                            AS "consumedKwh",
      sum(ep.generated_kwh - ep.consumed_kwh)         AS "energyBalanceKwh",
      sum(ep.consumed_kwh - ep.generated_kwh)         AS "energyGapKwh",
      CASE WHEN sum(ep.consumed_kwh) = 0 THEN NULL
           ELSE round(100 * least(sum(ep.generated_kwh), sum(ep.consumed_kwh))
                           / sum(ep.consumed_kwh), 2)
      END AS "solarCoveragePct",
      count(ep.reading_id)                            AS "readingCount"
    FROM building_members bm
    JOIN buildings b ON b.building_id = bm.building_id
    JOIN energy_periods ep ON ep.building_id = b.building_id
    WHERE bm.user_id = ${userId}
      AND b.building_id = ${buildingId}
      AND ep.period_start >= ${from}
      AND ep.period_start <  ${to}
    GROUP BY 1, 2, 3
    ORDER BY 1`);

  // Attach hasGap: compare actual reading count to expected hourly readings
  return rows.map(row => {
    const count = Number(row.readingCount);
    // Derive expected count from periodStart → periodEnd span in hours
    const spanMs = new Date(row.periodEnd) - new Date(row.periodStart);
    const spanHours = Math.round(spanMs / 3_600_000);
    return {
      ...row,
      readingCount: count,
      hasGap: count < spanHours,
    };
  });
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
