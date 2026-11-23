# Drift

Drift is a solar balance monitor for homes and buildings. It compares energy generated with energy consumed over the same periods and helps users follow the balance over time.

The AP project includes a browser prototype and an Express/Prisma REST API for buildings and interval readings. The prototype's local-storage data remains browser-local; the API persists readings in PostgreSQL.

The DBMS project materials are in [`dbms/`](dbms/): normalization, ER diagram, PostgreSQL schema, example API queries, and a timing report template. The timings must be filled from actual runs of the implemented database; no sample timings are presented as measured results.

## Run the Drift database materials

In a local PostgreSQL database, run the schema and deterministic development fixtures in order:

```sh
createdb drift_dbms
psql -v ON_ERROR_STOP=1 -d drift_dbms -f dbms/03_schema.sql -f dbms/seed.sql
```

The seed script creates one demo user, one building, and hourly readings for 2025. It is safe to rerun: existing demo records are retained and missing intervals are added. Use a fresh database for timing work, and record the actual PostgreSQL version and machine in [`dbms/05_query_timings.md`](dbms/05_query_timings.md).

## Run the browser-only preview

The dashboard uses JavaScript modules, so serve it over HTTP instead of opening the HTML file directly:

    cd frontend
    python3 -m http.server 8080

Open http://localhost:8080. Preview readings are stored in that browser only.

## Run the API-backed dashboard

Requirements: Node.js 20+ and PostgreSQL 15+. From the repository root:

    cp .env.example .env
    # Set DATABASE_URL in .env for your local PostgreSQL database.
    npm ci
    npm run prisma:generate
    npm run prisma:migrate:deploy
    npm run db:seed
    npm run dev

Open http://localhost:3000. Add ?mode=api&userId=1 to the page address to connect to the seeded demo account; replace 1 with the user ID printed by the seed command.

## Dashboard features

The dashboard displays generation, consumption, balance, and solar coverage; charts daily, weekly, and monthly trends; and highlights data quality concerns, missing hours, and hourly balance patterns. Users can set per-building browser-stored monthly coverage and surplus goals, compare buildings, estimate grid cost and CO₂ avoidance, and explore solar and battery scenarios. These are estimates; emission factors and example tariff slabs are editable and are not presented as official utility rates.

In API mode, users can import and export readings as CSV, with export date and column selection. Readings support server-side pagination, date filtering, search, and sorting. Import is available to building owners and editors; viewers remain read-only. Visit `/docs` for a compact API reference. Full endpoint details, completeness fields, and cost formulas are documented in [docs/api.md](docs/api.md). The X-User-Id header is a development identity mechanism for this class project, not production authentication.
