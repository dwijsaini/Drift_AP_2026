# Drift

Drift is a solar balance monitor for homes and buildings. It compares energy generated with energy consumed over the same periods and helps users follow the balance over time.

The AP project includes a browser dashboard and an Express/Prisma REST API for buildings and interval readings. Preview data stays in the current browser; API data is stored in PostgreSQL.

The DBMS project materials are in [`dbms/`](dbms/): normalization, ER diagram, PostgreSQL schema, example queries, and a timing report template. Timings must come from actual runs; no sample measurements are presented as measured results.

## Run the Drift database materials

In a local PostgreSQL database, run the schema and deterministic development fixtures in order:

```sh
createdb drift_dbms
psql -v ON_ERROR_STOP=1 -d drift_dbms -f dbms/03_schema.sql -f dbms/seed.sql
```

The seed script creates one demo user, one building, and hourly readings for 2025. It is safe to rerun: existing demo records are retained and missing intervals are added. Use a fresh database for timing work, and record the actual PostgreSQL version and machine in [`dbms/05_query_timings.md`](dbms/05_query_timings.md).

## Run the browser-only preview

The dashboard uses JavaScript modules, so serve it over HTTP instead of opening the HTML file directly:

```sh
cd frontend
python3 -m http.server 8080
```

Open http://localhost:8080. Preview readings are stored only in that browser. **Clear local data** removes the preview data.

## Run the API-backed dashboard

Requirements: Node.js 20+ and PostgreSQL 15+. From the repository root:

```sh
cp .env.example .env
# Set DATABASE_URL in .env for your local PostgreSQL database.
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000 for the browser-only preview served by Express. To connect the dashboard to PostgreSQL, open http://localhost:3000/?mode=api&userId=1, replacing `1` with the demo user ID printed by the seed command. The building selector, readings, summaries, and create/edit/delete actions then use the API. Read-only members can view readings but cannot change them.

## Dashboard features

The dashboard displays generation, consumption, balance, and solar coverage; charts daily, weekly, and monthly trends; and warns about missing hourly readings. Users can record grid imports, enter an electricity rate for a clearly labeled cost estimate, compare accessible buildings over the same date range, and use a what-if control to explore higher solar generation without changing saved readings.

In API mode, users can import and export readings as CSV. Import is available to building owners and editors; viewers remain read-only. CSV routes, building comparison, completeness fields, and estimated-cost formulas are documented in [docs/api.md](docs/api.md). The `X-User-Id` header is a development identity mechanism for this class project, not production authentication. Keep `.env` local and do not commit database credentials.
