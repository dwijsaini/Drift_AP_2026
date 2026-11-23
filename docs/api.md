# Drift API

## Local setup

Requirements: Node.js 20+, npm, and PostgreSQL 15+. From the repository root:

```sh
cp .env.example .env
# Set DATABASE_URL in .env to a local PostgreSQL database (e.g. postgresql://postgres:postgres@localhost:5432/drift?schema=public)
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
npm test
npm run dev
```

### Database Migration and Schema Management

Drift provides two paths for applying the schema to PostgreSQL:

1. **Versioned Prisma Migrations (`prisma migrate deploy`):**
   - Formal, reproducible migration tracking via `_prisma_migrations`.
   - Initial migration located at `prisma/migrations/20261120000000_initial_schema/migration.sql`.
   - Recommended for staging, CI/CD, and production environments.

2. **Development Schema Push (`npm run db:push`):**
   - Directly synchronizes `prisma/schema.prisma` with the target PostgreSQL database without recording migration history.
   - Useful for rapid local schema prototyping.

3. **Standalone SQL Deliverables (`dbms/03_schema.sql`):**
   - Pure SQL schema with identical types, constraints, and indexes. Can be initialized via:
     ```sh
     createdb drift
     psql -v ON_ERROR_STOP=1 -d drift -f dbms/03_schema.sql -f dbms/seed.sql
     ```

Do not run both the SQL seed script and the Prisma seed script against the same database instance to avoid duplicate intervals.

### Authentication & Identification

The Prisma seed prints the demo user IDs. The API expects an authenticated user ID in the `X-User-Id` request header on all `/api` endpoints:
```http
X-User-Id: 1
```
This header is a development identity mechanism. In production, an upstream authentication middleware or reverse proxy populates verified user tokens. The `/health` endpoint is unauthenticated and verifies both Express HTTP status and PostgreSQL connectivity.

---

## Data Models and Architecture

Drift uses PostgreSQL with Prisma ORM to manage multi-tenant solar energy monitoring. Relational names use PostgreSQL snake_case conventions via `@@map` annotations while exposing JavaScript camelCase properties.

### 1. `AppUser` (`app_users`)
Represents registered users who own or monitor buildings.
- `userId` (`user_id` BIGINT, PK): Identity sequence.
- `displayName` (`display_name` TEXT): User's full name.
- `email` (`email` TEXT, UNIQUE): Validated unique email address.
- `createdAt` (`created_at` TIMESTAMPTZ): User registration timestamp.
- **Relations:** 1-to-many with `BuildingMember`; 1-to-many with `EnergyPeriod` (as `recordedBy`).

### 2. `Building` (`buildings`)
Physical structure equipped with solar generation assets and electrical consumption meters.
- `buildingId` (`building_id` BIGINT, PK): Identity sequence.
- `name` (`name` TEXT): Building descriptor (e.g. "Drift Demo Home").
- `address` (`address` TEXT, optional): Physical address.
- `timezone` (`timezone` TEXT, default 'UTC'): IANA time zone (e.g. `Asia/Kolkata`). Critical for calendar-aligned summaries.
- `createdAt` (`created_at` TIMESTAMPTZ): Creation timestamp.
- **Relations:** 1-to-many with `BuildingMember` (cascades on delete); 1-to-many with `EnergyPeriod` (cascades on delete).

### 3. `BuildingMember` (`building_members`)
Role-based access control linking users to buildings.
- `buildingId` (`building_id` BIGINT, FK): References `buildings.building_id`.
- `userId` (`user_id` BIGINT, FK): References `app_users.user_id`.
- `role` (`role` ENUM): Access tier:
  - `OWNER`: Full administrative rights (manage building, add/remove members, upload/edit readings).
  - `EDITOR`: Operational rights (add, edit, import interval readings).
  - `VIEWER`: Read-only access (view readings and summary analytics).
- `joinedAt` (`joined_at` TIMESTAMPTZ): Membership timestamp.
- **Constraints & Indexes:** Composite Primary Key `(building_id, user_id)`; B-tree index `building_members_user_idx` on `(user_id, building_id)`.

### 4. `EnergyPeriod` (`energy_periods`)
Time-series interval readings capturing generation and consumption measurements.
- `readingId` (`reading_id` BIGINT, PK): Identity sequence.
- `buildingId` (`building_id` BIGINT, FK): References `buildings.building_id`.
- `periodStart` (`period_start` TIMESTAMPTZ): Beginning of interval.
- `periodEnd` (`period_end` TIMESTAMPTZ): End of interval (must be strictly after `periodStart`).
- `generatedKwh` (`generated_kwh` DECIMAL(12,3)): Solar electricity produced in kWh (>= 0).
- `consumedKwh` (`consumed_kwh` DECIMAL(12,3)): Total electricity consumed in kWh (>= 0).
- `gridImportKwh` (`grid_import_kwh` DECIMAL(12,3), optional): Electricity drawn from external grid.
- `batteryChargeKwh` (`battery_charge_kwh` DECIMAL(12,3), optional): Energy directed into battery storage.
- `batteryDischargeKwh` (`battery_discharge_kwh` DECIMAL(12,3), optional): Energy drawn from battery storage.
- `source` (`source` ENUM): Provenance: `MANUAL`, `IMPORT`, or `API`.
- `recordedByUserId` (`recorded_by_user_id` BIGINT, optional FK): Audit trail to `app_users.user_id`.
- `createdAt` (`created_at` TIMESTAMPTZ): Record creation timestamp.
- **Constraints & Indexes:**
  - Unique constraint on `(building_id, period_start, period_end)` to prevent duplicate interval readings.
  - B-tree index `energy_periods_building_time_idx` on `(building_id, period_start DESC)` for fast time-series filtering and ordered pagination.
  - Foreign key index on `recorded_by_user_id`.

---

## Realistic Seed Data

Running `npm run db:seed` executes `prisma/seed.js` and creates:
1. **Users:**
   - `demo@drift.local` (`Drift Demo User`) — Owner of Demo Home and Green Office Tower.
   - `priya@drift.local` (`Priya Mehta`) — Editor of Green Office Tower, Viewer of Demo Home.
2. **Buildings:**
   - `Drift Demo Home` (Bengaluru, `Asia/Kolkata` timezone).
   - `Green Office Tower` (Commercial building, Koramangala, `Asia/Kolkata` timezone).
3. **180 Hourly Readings (October 2026):**
   - **Residential Diurnal Profile (Demo Home):** 90 readings exhibiting solar peaks at midday (~4.5 kWh/hr with Gaussian/sine solar curve), low daytime consumption (~1.2 kWh), and elevated evening consumption (~2.8 kWh).
   - **Commercial Profile (Green Office Tower):** 90 readings exhibiting larger solar capacity (up to 12.0 kWh/hr peak), high business-hour consumption (8 AM – 6 PM, up to 8.5 kWh/hr), and low overnight baseload (~1.5 kWh/hr).

---

## Input Validation & Error Handling

All incoming HTTP parameters and JSON payloads are validated using Zod (`src/http.js` and `src/routes.js`):

- **ID Parameters (`idSchema`):** Coerced to positive BigInt. Rejects non-numeric, negative, or zero values with `400 Bad Request`.
- **Date/Time Parameters (`dateSchema`):** Must be valid ISO 8601 strings with timezone offset (e.g. `2026-10-01T00:00:00+05:30`).
- **Reading Intervals (`readingSchema`):**
  - `periodEnd` must be strictly after `periodStart`.
  - Reading duration must not exceed 365 days (`MAX_PERIOD_MS`), preventing accidental multi-year date inputs.
  - `generatedKwh` and `consumedKwh` must be non-negative finite numbers.
  - Single interval readings are capped at `MAX_KWH = 999,999` kWh to prevent magnitude entry errors (e.g. entering Wh or MWh instead of kWh).
  - `source` must match enum `MANUAL`, `IMPORT`, or `API`.

### Standardized Error Responses
```json
{
  "error": {
    "message": "Request validation failed",
    "details": [
      {
        "code": "custom",
        "message": "periodEnd must be after periodStart",
        "path": ["periodEnd"]
      }
    ]
  }
}
```
HTTP status codes:
- `400`: Validation error or invalid interval bounds.
- `401`: Missing or unknown `X-User-Id` header.
- `403`: Insufficient permission (e.g. VIEWER attempting to POST readings).
- `404`: Target building or reading ID not found.
- `409`: Unique interval collision (duplicate `buildingId`, `periodStart`, `periodEnd`).
- `500`: Internal database or server exception.

---

## Energy Calculations & Summary Metrics

Energy balance and solar coverage are computed at query time via `src/energyService.js` (and documented in `dbms/01_normalization.md` and `dbms/04_queries.sql`):

### Formulas
1. **Energy Balance (`energyBalanceKwh`):**
   $$\text{Balance} = \sum \text{Generated} - \sum \text{Consumed}$$
   - Positive ($> 0$): Solar surplus (generation exceeded consumption).
   - Negative ($< 0$): Grid deficit (consumption exceeded solar generation).

2. **Energy Gap (`energyGapKwh`):**
   $$\text{Gap} = \sum \text{Consumed} - \sum \text{Generated} = -\text{Balance}$$
   - Positive ($> 0$): Unmet energy requirement needing grid or battery supply.
   - Negative ($< 0$): Excess generation.

3. **Solar Coverage Percentage (`solarCoveragePct`):**
   $$\text{Coverage \%} = \frac{\min(\sum \text{Generated}, \sum \text{Consumed})}{\sum \text{Consumed}} \times 100$$
   - Capped at 100.00% so excess exported power does not artificially inflate self-consumption coverage.
   - Evaluates to `null` if total consumption is zero ($0\text{ kWh}$), safely preventing division-by-zero errors.

4. **Data Completeness & Gap Detection (`hasGap`):**
   `expectedReadingCount` counts local-hour slots whose starts fall within the requested range and calendar bucket. `missingPeriodCount = max(expectedReadingCount - readingCount, 0)`, and `hasGap` remains `missingPeriodCount > 0`.
   - This uses the existing hourly-reading assumption. Hour slots are generated in the building timezone and account for 23/25-hour daylight-saving days. A completely empty bucket is included with zero readings and all expected slots missing.

5. **Estimated Grid Cost:**
   $$\text{estimatedGridCostInr} = \text{recorded gridImportKwh} \times \text{electricityRateInrPerKwh}$$
   - This is an estimate based only on non-null recorded grid-import readings, rounded to paise. It is not a utility bill and excludes fixed charges, taxes, credits, and adjustments. If there are no recorded grid-import values or no rate was supplied, the estimate is `null`.

---

## Routes

All IDs are positive integer strings in JSON. Energy metrics are returned in kWh with up to 3 decimal places.

| Method and path | Access | Purpose |
|---|---|---|
| `GET /health` | Public | API and database health status. |
| `GET /docs` | Public | Interactive API documentation reference page. |
| `GET /api/buildings` | Member | List caller's accessible buildings and assigned roles. |
| `POST /api/buildings` | Signed-in user | Create building and assign caller as `OWNER`. Body: `{ "name", "address?", "timezone?" }`. |
| `GET /api/buildings/:buildingId/readings?from=&to=&page=&pageSize=&sortBy=&sortDir=&search=` | Member | List interval readings with server-side pagination, search, bounds, and sorting. |
| `POST /api/buildings/:buildingId/readings` | OWNER/EDITOR | Record new interval reading. Body conforms to `readingSchema`. |
| `PATCH /api/buildings/:buildingId/readings/:readingId` | OWNER/EDITOR | Partially update reading fields while verifying interval ordering. |
| `DELETE /api/buildings/:buildingId/readings/:readingId` | OWNER/EDITOR | Delete specific interval reading. |
| `GET /api/buildings/:buildingId/summaries/:granularity?from=&to=&electricityRateInrPerKwh=` | Member | Retrieve aggregated energy metrics. `:granularity` must be `daily`, `weekly`, or `monthly`. |
| `GET /api/buildings/comparison?from=&to=&electricityRateInrPerKwh=` | Member | Compare totals for all caller-accessible buildings over the same range. Rate is optional. |
| `GET /api/buildings/:buildingId/readings.csv?from=&to=&columns=` | Member | Export building readings as CSV with optional date bounds and column chooser. |
| `POST /api/buildings/:buildingId/readings.csv` | OWNER/EDITOR | Bulk import readings via CSV payload atomically using batch insertion. |

The CSV import/export routes are shared by both features: import validates the exact header order and applies the JSON reading constraints (period duration and kWh limits included); blank optional meter fields remain `null`. Export emits those same headers. Reading or exporting requires membership; import requires OWNER or EDITOR. It accepts JSON `{ "csv": "..." }`, 1–10,000 rows, and a 2 MB payload limit.

### Summary Endpoint Details

`GET /api/buildings/:buildingId/summaries/:granularity?from=&to=&electricityRateInrPerKwh=`
- **Path parameters:** `granularity` ∈ `['daily', 'weekly', 'monthly']`.
- **Query parameters:** `from` and `to` (required ISO 8601 timestamps); optional `electricityRateInrPerKwh` from 0 through 1000 with at most four decimal places.
- **Timezone alignment:** Intervals are aggregated using `date_trunc(unit, ep.period_start AT TIME ZONE b.timezone)`, ensuring local calendar days, weeks (starting Monday), and months align accurately with the building's physical location.
- **Completeness fields:** `readingCount`, `expectedReadingCount`, `missingPeriodCount`, and the existing `hasGap` flag. Calendar buckets with no readings are also returned.
- **Cost fields:** `gridImportKwh` and `gridImportReadingCount` describe recorded meter data. If a rate is supplied, each row also includes `electricityRateInrPerKwh`, `estimatedGridCostInr` (decimal string or `null`), and `estimatedGridCostLabel`. The label explicitly says this is not a utility bill.

### Building comparison

`GET /api/buildings/comparison?from=<ISO timestamp>&to=<ISO timestamp>&electricityRateInrPerKwh=<optional rate>` returns one row per accessible building, including `buildingId`, `buildingName`, `timezone`, `generatedKwh`, `consumedKwh`, `energyBalanceKwh`, `energyGapKwh`, `solarCoveragePct`, `readingCount`, `expectedReadingCount`, `missingPeriodCount`, and `hasGap`. The same optional rate adds recorded grid-import fields and the explicitly labeled estimated cost. A user with no accessible buildings receives `{ "data": [] }`.

#### Example Summary Response:
```json
{
  "data": [
    {
      "periodStart": "2026-10-01T00:00:00.000Z",
      "periodEnd": "2026-10-02T00:00:00.000Z",
      "timezone": "Asia/Kolkata",
      "generatedKwh": 38.921,
      "consumedKwh": 29.019,
      "energyBalanceKwh": 9.902,
      "energyGapKwh": -9.902,
      "solarCoveragePct": 100.00,
      "readingCount": 24,
      "hasGap": false
    }
  ]
}
```

---

## Testing & Verification

Execute the automated test suite using Node's built-in test runner:

```sh
npm test
```

The test suite (`test/energy.test.js`) verifies:
1. `computeEnergyMetrics`: Comprehensive unit test coverage for surplus, deficit, exact match, zero generation, and zero consumption edge cases.
2. `readingSchema`: Zod validation rules covering valid payloads, inverted dates, identical dates, multi-year durations (>365 days), negative values, and maximum kWh limits (>999,999 kWh).
3. `getEnergySummary`: Integration verification against PostgreSQL executing daily, weekly, and monthly aggregations with gap detection and role-based tenant isolation.
