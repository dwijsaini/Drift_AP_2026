# Drift database normalization

## Scope and assumptions

Drift stores readings for a building and a time interval. Each interval has energy generated and consumed in kWh, with optional grid-import and battery readings. Users can belong to multiple buildings, and readings can be manually recorded or imported. A building has one aggregated reading per interval; imports that overlap an existing interval must be reconciled by the API before insertion. All timestamps are stored with a time zone, and reports convert them to the building's local time zone in the application.

The energy gap and solar coverage are derived values, not stored values:

- `energy_gap_kwh = consumed_kwh - generated_kwh` (positive means consumption exceeded generation).
- `solar_coverage_pct = 100 * min(generated_kwh, consumed_kwh) / consumed_kwh`; it is `NULL` when consumption is zero. Capping at 100% means exported surplus does not inflate the share of consumption covered by solar.

## Starting unnormalized record (UNF)

A first draft might store a building, user and a list of readings in one row:

`(building_id, building_name, address, member_ids[], member_names[], intervals[{start,end,generated,consumed,grid_import,battery_charge,battery_discharge}])`

The member and interval arrays contain repeating groups. A building name or address would also be repeated for every user and every interval, creating update, insertion and deletion anomalies.

## First normal form (1NF)

Make every field atomic and give each interval its own row. Do not store arrays or nested interval objects in a relational row:

`(building_id, building_name, address, period_start, period_end, generated_kwh, consumed_kwh, grid_import_kwh, battery_charge_kwh, battery_discharge_kwh, recorded_by_user_id, recorded_by_name)`

Candidate key: `(building_id, period_start, period_end)`. Every column contains a single value. However, building attributes depend only on `building_id`, and a user's name depends only on `recorded_by_user_id`, not on the full interval key.

## Second normal form (2NF)

Remove partial dependencies from the composite interval key:

- `BUILDINGS(building_id, name, address, timezone, created_at)`
- `ENERGY_PERIODS(building_id, period_start, period_end, generated_kwh, consumed_kwh, grid_import_kwh, battery_charge_kwh, battery_discharge_kwh, source, recorded_by_user_id, created_at)`

In `ENERGY_PERIODS`, every non-key measurement describes the entire building interval. Building name, address and time zone are stored once in `BUILDINGS`.

## Third normal form (3NF)

Remove user details and membership facts from the measurements. The final relations are:

- `APP_USERS(user_id, display_name, email, created_at)`
- `BUILDINGS(building_id, name, address, timezone, created_at)`
- `BUILDING_MEMBERS(building_id, user_id, role, joined_at)`
- `ENERGY_PERIODS(reading_id, building_id, period_start, period_end, generated_kwh, consumed_kwh, grid_import_kwh, battery_charge_kwh, battery_discharge_kwh, source, recorded_by_user_id, created_at)`

Functional dependencies include:

- `user_id → display_name, email, created_at`
- `building_id → name, address, timezone, created_at`
- `(building_id, user_id) → role, joined_at`
- `reading_id → building_id, period_start, period_end, all measurements, source, recorded_by_user_id, created_at`
- `(building_id, period_start, period_end) → reading_id, all measurements, source, recorded_by_user_id, created_at`

Every non-key attribute depends on a key, the whole key and nothing but the key. Derived gap and coverage values are computed in queries, preventing inconsistent copies. The schema's foreign keys, uniqueness rules and check constraints are in [`03_schema.sql`](03_schema.sql).

## BCNF

The listed relations satisfy BCNF under the stated dependencies: each determinant is a candidate key. `BUILDING_MEMBERS` has the composite key `(building_id, user_id)`, while `ENERGY_PERIODS` has both `reading_id` and the natural interval key as candidate keys. If the product later permits multiple independent sensors or sources per building and interval, that assumption changes; model a separate source/device key instead of inserting duplicate interval rows.
