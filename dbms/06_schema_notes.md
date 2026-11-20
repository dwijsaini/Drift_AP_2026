# Prisma Schema Design Notes and Prisma-to-SQL Mapping

This document explains the design decisions in `prisma/schema.prisma` and shows
how each Prisma model maps to its PostgreSQL table, including `@@map` directives
and the generated DDL equivalents.

---

## Enums

### `ReadingSource` → `reading_source`

```prisma
enum ReadingSource {
  MANUAL   // User typed the reading into the UI
  IMPORT   // Uploaded via CSV or bulk import
  API      // Posted programmatically via the REST API
  @@map("reading_source")
}
```

**SQL equivalent:**
```sql
CREATE TYPE reading_source AS ENUM ('MANUAL', 'IMPORT', 'API');
```

`MANUAL` is used for hand-entered readings, `IMPORT` for batch CSV uploads, and
`API` for readings posted by automated clients (inverters, smart meters, etc.).
Tracking the source lets operators audit data quality: API and IMPORT readings
may be corrected in bulk while MANUAL readings are trusted as human-verified.

### `MembershipRole` → `membership_role`

```prisma
enum MembershipRole {
  OWNER    // Full control: manage members, edit all readings, delete building
  EDITOR   // Can create and edit readings; cannot manage members or delete building
  VIEWER   // Read-only access to all readings and summaries
  @@map("membership_role")
}
```

**SQL equivalent:**
```sql
CREATE TYPE membership_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
```

The three-level hierarchy covers the typical household/SME energy monitoring
use case: an installer sets up the building (OWNER), hands day-to-day reading
entry to a staff member (EDITOR), and allows an auditor or landlord read-only
access (VIEWER).

---

## Models

### `AppUser` → `app_users`

| Prisma field | SQL column | Type | Notes |
|---|---|---|---|
| `userId` | `user_id` | `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Autoincrement via `@default(autoincrement())` |
| `displayName` | `display_name` | `TEXT NOT NULL` | `@db.Text` forces `TEXT` rather than `VARCHAR` |
| `email` | `email` | `TEXT NOT NULL UNIQUE` | Prisma `@unique` becomes `UNIQUE` constraint |
| `createdAt` | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | `@db.Timestamptz(6)` → 6-digit microsecond precision |

```sql
CREATE TABLE app_users (
    user_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The raw SQL DDL (`dbms/03_schema.sql`) adds `CHECK (length(trim(display_name)) > 0)`
and an email format check that Prisma cannot express natively — those exist only
in the SQL path.

---

### `Building` → `buildings`

| Prisma field | SQL column | Type | Notes |
|---|---|---|---|
| `buildingId` | `building_id` | `BIGINT IDENTITY PK` | |
| `name` | `name` | `TEXT NOT NULL` | |
| `address` | `address` | `TEXT` (nullable) | Prisma `String?` → no `NOT NULL` |
| `timezone` | `timezone` | `TEXT NOT NULL DEFAULT 'UTC'` | IANA timezone string stored as plain text |
| `createdAt` | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

The `timezone` field stores an IANA timezone name (e.g. `Asia/Kolkata`). It is
used in every aggregation query (`AT TIME ZONE b.timezone`) so that daily,
weekly, and monthly buckets align with local midnight rather than UTC midnight.
Storing it as free-form text means the app does not validate the IANA database —
invalid strings silently fall back to UTC in PostgreSQL.

---

### `BuildingMember` → `building_members`

| Prisma field | SQL column | Type | Notes |
|---|---|---|---|
| `buildingId` | `building_id` | `BIGINT NOT NULL REFERENCES buildings` | Part of composite PK |
| `userId` | `user_id` | `BIGINT NOT NULL REFERENCES app_users` | Part of composite PK |
| `role` | `role` | `membership_role NOT NULL` | Enum column |
| `joinedAt` | `joined_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Composite primary key:** `@@id([buildingId, userId])` → `PRIMARY KEY (building_id, user_id)`.
This guarantees exactly one membership record per (building, user) pair.

**Additional index:** `@@index([userId, buildingId], map: "building_members_user_idx")`
enables the common access pattern of "list all buildings for user X" without
a full table scan. The column order is `(user_id, building_id)` (user first)
because queries filter by user; this order lets PostgreSQL use the index for
the `WHERE user_id = $1` predicate.

```sql
CREATE TABLE building_members (
    building_id BIGINT NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    role        membership_role NOT NULL,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (building_id, user_id)
);
CREATE INDEX building_members_user_idx ON building_members (user_id, building_id);
```

Both foreign keys are `ON DELETE CASCADE`: removing a building removes its
memberships; removing a user removes their memberships.

---

### `EnergyPeriod` → `energy_periods`

| Prisma field | SQL column | Type | Notes |
|---|---|---|---|
| `readingId` | `reading_id` | `BIGINT IDENTITY PK` | Surrogate key |
| `buildingId` | `building_id` | `BIGINT NOT NULL REFERENCES buildings` | |
| `periodStart` | `period_start` | `TIMESTAMPTZ NOT NULL` | Inclusive start of the measurement interval |
| `periodEnd` | `period_end` | `TIMESTAMPTZ NOT NULL` | Exclusive end of the measurement interval |
| `generatedKwh` | `generated_kwh` | `NUMERIC(12, 3) NOT NULL` | Solar generation in kWh |
| `consumedKwh` | `consumed_kwh` | `NUMERIC(12, 3) NOT NULL` | Consumption in kWh |
| `gridImportKwh` | `grid_import_kwh` | `NUMERIC(12, 3)` (nullable) | Grid draw; null when not metered |
| `batteryChargeKwh` | `battery_charge_kwh` | `NUMERIC(12, 3)` (nullable) | Battery charge; null when no battery |
| `batteryDischargeKwh` | `battery_discharge_kwh` | `NUMERIC(12, 3)` (nullable) | Battery discharge |
| `source` | `source` | `reading_source NOT NULL` | MANUAL / IMPORT / API |
| `recordedByUserId` | `recorded_by_user_id` | `BIGINT REFERENCES app_users ON DELETE SET NULL` | Nullable audit trail |
| `createdAt` | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

#### Why `periodStart` / `periodEnd` instead of a single timestamp

A single timestamp would be ambiguous about whether it represents the start or
end of the measurement window, and it cannot represent sub-daily intervals
without additional columns. The two-timestamp design makes the interval explicit:
`[periodStart, periodEnd)`. Hourly readings have a one-hour gap; daily totals
have a 24-hour gap. The exclusive-end convention means intervals can be
concatenated without overlap: one interval's `periodEnd` equals the next
interval's `periodStart`.

#### Why `Decimal(12, 3)` and not `Float`

`Float` (IEEE 754 double) has rounding errors in decimal arithmetic.
`NUMERIC(12, 3)` stores exact decimal values to three decimal places, ensuring
that summed kWh values match across paginated reports without floating-point
drift. 12 total digits (9 before the decimal point) supports up to 999,999,999
kWh — well beyond any realistic building lifetime generation.

#### Unique constraint on `(buildingId, periodStart, periodEnd)`

```prisma
@@unique([buildingId, periodStart, periodEnd])
```
```sql
UNIQUE (building_id, period_start, period_end)
```

This prevents duplicate energy readings for the same interval. Without it,
a CSV import or API retry could insert the same hour twice, doubling the
apparent generation and consumption for that period. The constraint causes
Prisma to throw a `P2002` error (HTTP 409) on conflict, which the error
middleware surfaces as a clear duplicate-interval response.

#### Index on `(buildingId, periodStart DESC)`

```prisma
@@index([buildingId, periodStart(sort: Desc)], map: "energy_periods_building_time_idx")
```
```sql
CREATE INDEX energy_periods_building_time_idx
    ON energy_periods (building_id, period_start DESC);
```

The most common query pattern is "latest N readings for building X" — the
sort order is descending by time. By storing the index in `DESC` order, the
database can satisfy `ORDER BY period_start DESC` with a forward index scan
(no sort step), making pagination efficient. The leading `building_id` column
narrows the scan to one building before the time ordering applies.

#### Energy balance formula

The energy balance and gap metrics are **calculated at query time** from
`generated_kwh` and `consumed_kwh`; they are not stored as redundant columns:

```
balance_kwh      = generated_kwh - consumed_kwh   (negative → deficit)
gap_kwh          = consumed_kwh  - generated_kwh   (positive → deficit)
solar_coverage_% = min(generated, consumed) / consumed × 100
                   (NULL when consumed = 0; capped at 100 % implicitly by min())
```

`balance_kwh` and `gap_kwh` are mathematical opposites (`balance = -gap`).
Both are returned by the summaries endpoint because different UI components
use each sign convention.

---

## Prisma `@@map` summary

| Prisma name | SQL name |
|---|---|
| `AppUser` | `app_users` |
| `Building` | `buildings` |
| `BuildingMember` | `building_members` |
| `EnergyPeriod` | `energy_periods` |
| `MembershipRole` enum | `membership_role` |
| `ReadingSource` enum | `reading_source` |
| `userId` / `buildingId` / … | `user_id` / `building_id` / … |

Prisma uses camelCase for all field names and maps them to snake_case SQL
columns via `@map` on each field and `@@map` on each model. The generated
Prisma Client exposes the camelCase names, while the database stores snake_case.
