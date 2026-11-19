# Drift

Drift is a solar balance monitor for homes and buildings. It compares energy generated with energy consumed over the same periods and helps users follow the balance over time.

The AP project is being built in stages. The first stage is a small browser prototype for entering interval readings and viewing generation, consumption, balance, and solar coverage. Data in this prototype stays in the browser's local storage; the REST API and database connection will be added in a later stage.

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
