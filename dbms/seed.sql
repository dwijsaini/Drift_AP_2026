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
           starts_at,
           starts_at + interval '1 hour',
           generated_kwh,
           consumed_kwh,
           greatest(consumed_kwh - generated_kwh, 0),
           greatest(generated_kwh - consumed_kwh, 0),
           greatest(consumed_kwh - generated_kwh, 0) / 2,
           'API',
           v_user_id
      FROM generate_series(0, 24 * 365 - 1) AS s(hour_number)
      CROSS JOIN LATERAL (
          SELECT TIMESTAMPTZ '2025-01-01 00:00:00+05:30'
                     + s.hour_number * interval '1 hour' AS starts_at,
                 round((1 + mod(s.hour_number, 20)::numeric / 10), 3) AS generated_kwh,
                 round((2 + mod(s.hour_number * 7, 25)::numeric / 10), 3) AS consumed_kwh
      ) AS energy
    ON CONFLICT (building_id, period_start, period_end) DO NOTHING;
END
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
