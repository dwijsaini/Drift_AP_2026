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

## Run the first-stage prototype

Open [`frontend/index.html`](frontend/index.html) in a browser. Add a building name and energy readings for matching time periods. The prototype saves its data in that browser only. Use **Clear local data** to remove the saved prototype data.

## Run the REST API

The API uses the existing Prisma/PostgreSQL building, membership, and energy-period models. Copy `.env.example` to `.env`, set `DATABASE_URL`, then run `npm install`, `npm run db:push`, `npm run db:seed`, and `npm run dev`. See [`docs/api.md`](docs/api.md) for routes, CSV format, summary/comparison metrics, and authentication details.
