-- Drift PostgreSQL schema. Energy amounts are kWh; timestamps are timezone-aware.
CREATE TYPE membership_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
CREATE TYPE reading_source AS ENUM ('MANUAL', 'IMPORT', 'API');

CREATE TABLE app_users (
    user_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name   TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    email          TEXT NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
    building_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    address       TEXT,
    timezone      TEXT NOT NULL DEFAULT 'UTC',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE building_members (
    building_id  BIGINT NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    role         membership_role NOT NULL,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (building_id, user_id)
);

CREATE TABLE energy_periods (
    reading_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    building_id           BIGINT NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    period_start          TIMESTAMPTZ NOT NULL,
    period_end            TIMESTAMPTZ NOT NULL,
    generated_kwh         NUMERIC(12, 3) NOT NULL CHECK (generated_kwh >= 0),
    consumed_kwh          NUMERIC(12, 3) NOT NULL CHECK (consumed_kwh >= 0),
    grid_import_kwh       NUMERIC(12, 3) CHECK (grid_import_kwh >= 0),
    battery_charge_kwh    NUMERIC(12, 3) CHECK (battery_charge_kwh >= 0),
    battery_discharge_kwh NUMERIC(12, 3) CHECK (battery_discharge_kwh >= 0),
    source                reading_source NOT NULL,
    recorded_by_user_id   BIGINT REFERENCES app_users(user_id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end > period_start),
    UNIQUE (building_id, period_start, period_end)
);

-- Common access paths for membership checks and time-series reads.
CREATE INDEX energy_periods_building_time_idx
    ON energy_periods (building_id, period_start DESC);
-- Keep this a full index so it matches the Prisma @@index declaration.
CREATE INDEX energy_periods_recorded_by_idx
    ON energy_periods (recorded_by_user_id);
CREATE INDEX building_members_user_idx ON building_members (user_id, building_id);
