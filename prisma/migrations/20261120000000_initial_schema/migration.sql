-- Drift initial schema migration
-- Generated to match prisma/schema.prisma and dbms/03_schema.sql
-- Applied via: prisma migrate deploy
-- Or directly: psql -d drift -f prisma/migrations/20261120000000_initial_schema/migration.sql

-- Enums
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
CREATE TYPE "reading_source" AS ENUM ('MANUAL', 'IMPORT', 'API');

-- AppUser -> app_users
CREATE TABLE "app_users" (
    "user_id"      BIGINT GENERATED ALWAYS AS IDENTITY,
    "display_name" TEXT    NOT NULL,
    "email"        TEXT    NOT NULL,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_users_pkey" PRIMARY KEY ("user_id")
);
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- Building -> buildings
CREATE TABLE "buildings" (
    "building_id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "name"        TEXT NOT NULL,
    "address"     TEXT,
    "timezone"    TEXT NOT NULL DEFAULT 'UTC',
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "buildings_pkey" PRIMARY KEY ("building_id")
);

-- BuildingMember -> building_members
CREATE TABLE "building_members" (
    "building_id" BIGINT         NOT NULL,
    "user_id"     BIGINT         NOT NULL,
    "role"        "membership_role" NOT NULL,
    "joined_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "building_members_pkey" PRIMARY KEY ("building_id","user_id")
);

-- EnergyPeriod -> energy_periods
CREATE TABLE "energy_periods" (
    "reading_id"             BIGINT GENERATED ALWAYS AS IDENTITY,
    "building_id"            BIGINT           NOT NULL,
    "period_start"           TIMESTAMPTZ(6)   NOT NULL,
    "period_end"             TIMESTAMPTZ(6)   NOT NULL,
    "generated_kwh"          DECIMAL(12,3)    NOT NULL,
    "consumed_kwh"           DECIMAL(12,3)    NOT NULL,
    "grid_import_kwh"        DECIMAL(12,3),
    "battery_charge_kwh"     DECIMAL(12,3),
    "battery_discharge_kwh"  DECIMAL(12,3),
    "source"                 "reading_source" NOT NULL,
    "recorded_by_user_id"    BIGINT,
    "created_at"             TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "energy_periods_pkey" PRIMARY KEY ("reading_id")
);

-- Unique constraint: one reading per (building, interval)
CREATE UNIQUE INDEX "energy_periods_building_id_period_start_period_end_key"
    ON "energy_periods"("building_id","period_start","period_end");

-- Index for time-series reads (DESC so ORDER BY period_start DESC is a forward scan)
CREATE INDEX "energy_periods_building_time_idx"
    ON "energy_periods"("building_id","period_start" DESC);

-- Index for audit queries filtering by recorder
CREATE INDEX "energy_periods_recorded_by_idx"
    ON "energy_periods"("recorded_by_user_id");

-- Index for membership lookups by user
CREATE INDEX "building_members_user_idx"
    ON "building_members"("user_id","building_id");

-- Foreign keys
ALTER TABLE "building_members"
    ADD CONSTRAINT "building_members_building_id_fkey"
        FOREIGN KEY ("building_id") REFERENCES "buildings"("building_id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "building_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "app_users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "energy_periods"
    ADD CONSTRAINT "energy_periods_building_id_fkey"
        FOREIGN KEY ("building_id") REFERENCES "buildings"("building_id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "energy_periods_recorded_by_user_id_fkey"
        FOREIGN KEY ("recorded_by_user_id") REFERENCES "app_users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
