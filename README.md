# Drift

Drift is a solar balance monitor for homes and buildings. It compares energy generated with energy consumed over the same periods and helps users follow the balance over time.

The AP project contains a browser dashboard, a Node.js/Express REST API, and Prisma models for buildings and energy readings. The dashboard supports browser-only preview mode and API mode backed by PostgreSQL.

The DBMS design materials are in [dbms/](dbms/): normalization, ER diagram, SQL schema, example queries, and a timing report template. Timings must come from actual runs; no sample measurements are presented as measured results.

## Run the Drift database materials

In a local PostgreSQL database, run the schema and deterministic development fixtures in order:

```sh
createdb drift_dbms
psql -v ON_ERROR_STOP=1 -d drift_dbms -f dbms/03_schema.sql -f dbms/seed.sql
```

Use a fresh database for timing work, and record the actual PostgreSQL version and machine in [dbms/05_query_timings.md](dbms/05_query_timings.md).

## Run the browser-only preview

The dashboard uses JavaScript modules, so serve it over HTTP instead of opening the HTML file directly:

```sh
cd frontend
python3 -m http.server 8080
```

Open http://localhost:8080. Readings are stored in that browser only. **Clear local data** removes the preview data.

## Run the API and connected dashboard

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

Open http://localhost:3000 for the browser-only preview served by Express. To connect the dashboard to PostgreSQL, use http://localhost:3000/?mode=api&userId=1, replacing 1 with the demo user ID printed by the seed command. The building selector, readings, summaries, and create/edit/delete actions then use the API. Read-only members can view readings but cannot change them.

X-User-Id is a development identity header for this class project; it is not production authentication. See [docs/api.md](docs/api.md) for routes, validation, CSV import/export, and summary formulas. Keep .env local and do not commit database credentials.
