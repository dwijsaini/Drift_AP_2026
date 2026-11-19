# Drift API

## Local setup

Requirements: Node.js 20+, npm, and PostgreSQL. From the repository root:

```sh
cp .env.example .env
# Set DATABASE_URL in .env to a local PostgreSQL database.
npm install
npm run db:push
npm run db:seed
npm run dev
```

`npm run db:push` applies the existing Prisma schema. Alternatively, initialize a dedicated database from the SQL deliverables with `psql -v ON_ERROR_STOP=1 -d drift -f dbms/03_schema.sql -f dbms/seed.sql`. Do not run both schema paths against an already initialized database. The SQL seed includes a demo user/building and hourly fixture readings; the Prisma seed creates a demo user, building, and membership.

The Prisma seed prints the demo user id. In development, the API accepts that id in `X-User-Id`. Outside development, callers must send a signed JWT as `Authorization: Bearer <token>`; the server verifies HS256, issuer `drift-api`, audience `drift`, expiration, and a positive numeric `sub` matching an existing user. Set a private `JWT_SECRET` of at least 32 characters outside source control. The API does not issue tokens; connect the existing identity provider to mint them. `/health` checks both the HTTP process and PostgreSQL connection and needs no identity header.

## Routes

All IDs are positive integer values represented as strings in JSON where JavaScript cannot safely represent PostgreSQL `BIGINT`. Energy values are kWh with three decimal places as defined by the existing schema. Reading creation relies on the existing unique `(building, period_start, period_end)` constraint to reject duplicate intervals.

| Method and path | Access | Purpose |
|---|---|---|
| `GET /health` | Public | API and database health. |
| `GET /api/buildings` | Member | List the caller's buildings and their role. |
| `POST /api/buildings` | Signed-in user | Create a building and OWNER membership atomically. Body: `{ "name", "address?", "timezone?" }`. |
| `GET /api/buildings/:buildingId/readings?from=&to=` | Member | List readings ordered by start time; optional ISO timestamp bounds. |
| `POST /api/buildings/:buildingId/readings` | OWNER/EDITOR | Create an interval reading. Uses Prisma field names; `source` defaults to `MANUAL`. |
| `PATCH /api/buildings/:buildingId/readings/:readingId` | OWNER/EDITOR | Update supplied fields; period order is checked against existing and new values. |
| `DELETE /api/buildings/:buildingId/readings/:readingId` | OWNER/EDITOR | Delete one reading. |
| `GET /api/buildings/:buildingId/summaries/{daily,weekly,monthly}?from=&to=` | Member | Aggregate generation, consumption, balance, gap, and capped solar coverage in building-local periods. Both bounds are required. |
| `GET /api/buildings/:buildingId/readings.csv` | Member | Export readings as CSV. |
| `POST /api/buildings/:buildingId/readings.csv` | OWNER/EDITOR | Import CSV atomically. Send JSON `{ "csv": "periodStart,periodEnd,...\\n..." }`; accepts 1–10,000 rows and rejects duplicate intervals. |

Errors use `{ "error": { "message": "...", "details?": [...] } }`. Validation errors return 400, missing/unauthorized identity returns 401, disallowed role returns 403, missing resources return 404, duplicate keys return 409, and unexpected errors return a generic 500 response.

Summary definitions follow [`dbms/04_queries.sql`](../dbms/04_queries.sql): balance is generation minus consumption; gap is consumption minus generation; solar coverage is `min(generation, consumption) / consumption * 100` and is `null` when consumption is zero. These metrics are calculated at query time, not stored as duplicate columns.
