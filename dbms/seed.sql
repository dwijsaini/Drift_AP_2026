-- Deterministic development fixtures for the Drift DBMS queries.
-- Run after 03_schema.sql in a dedicated local database.
-- Re-running this file keeps the same demo entities and skips existing periods.
DO $seed$
DECLARE
    v_user_id BIGINT;
    v_building_id BIGINT;
BEGIN
    INSERT INTO app_users (display_name, email)
    VALUES ('Drift Demo User', 'demo@drift.local')
    ON CONFLICT (email) DO UPDATE
        SET display_name = EXCLUDED.display_name
    RETURNING user_id INTO v_user_id;

    SELECT building_id
      INTO v_building_id
      FROM buildings
     WHERE name = 'Drift Demo Home'
       AND address = '1 Solar Lane, Bengaluru'
     ORDER BY building_id
     LIMIT 1;

    IF v_building_id IS NULL THEN
        INSERT INTO buildings (name, address, timezone)
        VALUES ('Drift Demo Home', '1 Solar Lane, Bengaluru', 'Asia/Kolkata')
        RETURNING building_id INTO v_building_id;
    END IF;

    INSERT INTO building_members (building_id, user_id, role)
    VALUES (v_building_id, v_user_id, 'OWNER')
    ON CONFLICT (building_id, user_id) DO NOTHING;

    INSERT INTO energy_periods (
        building_id, period_start, period_end, generated_kwh, consumed_kwh,
        grid_import_kwh, battery_charge_kwh, battery_discharge_kwh,
        source, recorded_by_user_id
    )
    SELECT v_building_id,
           energy.starts_at,
           energy.starts_at + interval '1 hour',
           energy.generated_kwh,
           energy.consumed_kwh,
           greatest(energy.consumed_kwh - energy.generated_kwh, 0),
           greatest(energy.generated_kwh - energy.consumed_kwh, 0),
           greatest(energy.consumed_kwh - energy.generated_kwh, 0) / 2,
           'API',
           v_user_id
      FROM generate_series(0, 24 * 365 - 1) AS s(hour_number)
      CROSS JOIN LATERAL (
          SELECT TIMESTAMPTZ '2025-01-01 00:00:00+05:30'
                     + s.hour_number * interval '1 hour' AS starts_at,
                 mod(s.hour_number, 24) AS local_hour,
                 (s.hour_number / 24) AS day_of_year
      ) AS t
      CROSS JOIN LATERAL (
          SELECT (0.65 + 0.35 * sin((t.day_of_year * 13 + 5)::numeric)
                               * cos((t.day_of_year * 3)::numeric)) AS weather_factor,
                 CASE WHEN mod(t.day_of_year, 7) IN (3, 4) THEN 1.25 ELSE 1.0 END AS day_factor
      ) AS w
      CROSS JOIN LATERAL (
          SELECT t.starts_at,
                 round(
                     (CASE WHEN t.local_hour >= 6 AND t.local_hour <= 18 THEN
                         greatest(0::numeric,
                             (4.8::numeric * w.weather_factor::numeric
                              * sin(pi() * (t.local_hour - 6)::numeric / 13.0)::numeric)
                         )
                     ELSE 0::numeric END)::numeric, 3
                 ) AS generated_kwh,
                 round(
                     (greatest(0.35::numeric,
                         (CASE
                             WHEN t.local_hour BETWEEN 7 AND 9 THEN 2.2::numeric
                             WHEN t.local_hour BETWEEN 18 AND 22 THEN 3.1::numeric
                             WHEN t.local_hour BETWEEN 10 AND 17 THEN 1.1::numeric
                             ELSE 0.6::numeric
                          END * w.day_factor::numeric
                          + 0.15::numeric * sin((s.hour_number * 1.7)::numeric)::numeric)
                     ))::numeric, 3
                 ) AS consumed_kwh
      ) AS energy
    ON CONFLICT (building_id, period_start, period_end) DO NOTHING;
END;
$seed$;

ANALYZE app_users;
ANALYZE buildings;
ANALYZE building_members;
ANALYZE energy_periods;

-- Copy these values into query parameters when running the DBMS workload.
SELECT u.user_id,
       b.building_id,
       min(ep.period_start) AS range_start,
       max(ep.period_end) AS range_end,
       count(*) AS reading_count
FROM app_users u
JOIN building_members bm ON bm.user_id = u.user_id
JOIN buildings b ON b.building_id = bm.building_id
JOIN energy_periods ep ON ep.building_id = b.building_id
WHERE u.email = 'demo@drift.local'
  AND b.name = 'Drift Demo Home'
  AND b.address = '1 Solar Lane, Bengaluru'
GROUP BY u.user_id, b.building_id;
