-- READ R1: Daily solar balance for one building. The join verifies membership.
SELECT b.building_id,
       date_trunc('day', ep.period_start AT TIME ZONE b.timezone)::date AS local_day,
       sum(ep.generated_kwh) AS generated_kwh,
       sum(ep.consumed_kwh) AS consumed_kwh,
       sum(ep.consumed_kwh - ep.generated_kwh) AS energy_gap_kwh,
       CASE WHEN sum(ep.consumed_kwh) = 0 THEN NULL
            ELSE round(100 * least(sum(ep.generated_kwh), sum(ep.consumed_kwh))
                            / sum(ep.consumed_kwh), 2)
       END AS solar_coverage_pct
FROM building_members bm
JOIN buildings b ON b.building_id = bm.building_id
JOIN energy_periods ep ON ep.building_id = b.building_id
WHERE bm.user_id = $1
  AND b.building_id = $2
  AND ep.period_start >= $3
  AND ep.period_start < $4
GROUP BY b.building_id, local_day
ORDER BY local_day;

-- READ R2: Monthly balance and direction of change for the selected building.
WITH monthly AS (
    SELECT b.building_id,
           date_trunc('month', ep.period_start AT TIME ZONE b.timezone)::date AS month,
           sum(ep.generated_kwh) AS generated_kwh,
           sum(ep.consumed_kwh) AS consumed_kwh,
           sum(ep.consumed_kwh - ep.generated_kwh) AS energy_gap_kwh
    FROM building_members bm
    JOIN buildings b ON b.building_id = bm.building_id
    JOIN energy_periods ep ON ep.building_id = b.building_id
    WHERE bm.user_id = $1
      AND b.building_id = $2
      AND ep.period_start >= $3
      AND ep.period_start < $4
    GROUP BY b.building_id, month
)
SELECT month, generated_kwh, consumed_kwh, energy_gap_kwh,
       energy_gap_kwh - lag(energy_gap_kwh) OVER (ORDER BY month) AS gap_change_kwh
FROM monthly
ORDER BY month;

-- READ R3: Daily grid-import and battery totals for a dashboard completeness view.
SELECT b.building_id,
       date_trunc('day', ep.period_start AT TIME ZONE b.timezone)::date AS local_day,
       sum(ep.grid_import_kwh) AS grid_import_kwh,
       sum(ep.battery_charge_kwh) AS battery_charge_kwh,
       sum(ep.battery_discharge_kwh) AS battery_discharge_kwh
FROM building_members bm
JOIN buildings b ON b.building_id = bm.building_id
JOIN energy_periods ep ON ep.building_id = b.building_id
WHERE bm.user_id = $1
  AND b.building_id = $2
  AND ep.period_start >= $3
  AND ep.period_start < $4
GROUP BY b.building_id, local_day
ORDER BY local_day;

-- WRITE W1: Record or import one interval. Prisma/API should handle the unique
-- interval conflict explicitly (reject or replace after user confirmation).
INSERT INTO energy_periods (
    building_id, period_start, period_end, generated_kwh, consumed_kwh,
    grid_import_kwh, battery_charge_kwh, battery_discharge_kwh,
    source, recorded_by_user_id
)
SELECT b.building_id, $3, $4, $5, $6, $7, $8, $9, $10, $1
FROM building_members bm
JOIN buildings b ON b.building_id = bm.building_id
WHERE bm.user_id = $1
  AND b.building_id = $2
  AND bm.role IN ('OWNER', 'EDITOR')
RETURNING reading_id;

-- WRITE W2: Correct a reading only if the actor can edit the building.
UPDATE energy_periods ep
SET generated_kwh = $3,
    consumed_kwh = $4,
    grid_import_kwh = $5,
    battery_charge_kwh = $6,
    battery_discharge_kwh = $7
FROM building_members bm
WHERE ep.reading_id = $1
  AND bm.building_id = ep.building_id
  AND bm.user_id = $2
  AND bm.role IN ('OWNER', 'EDITOR')
RETURNING ep.reading_id;
