# Drift query timing report

Timings are intentionally blank until the queries are run against the team's PostgreSQL database. Do not estimate or copy numbers. For a repeatable local run, apply `03_schema.sql` and then `seed.sql` in a fresh database. Run each query three times using `EXPLAIN (ANALYZE, BUFFERS)` and report the arithmetic average. Use the same dataset, database version, machine and parameters for all runs. For write queries, use a transaction and roll it back so each run starts from the same data. Save each raw plan in `dbms/plans/`.

| Query | Type | What it does | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Average (ms) | Scan type |
|---|---|---|---:|---:|---:|---:|---|
| R1 | READ | Daily generated/consumed balance and coverage | | | | | |
| R2 | READ | Monthly energy gap and change from prior month | | | | | |
| R3 | READ | Weekly generated/consumed balance and coverage | | | | | |
| R4 | READ | Daily grid-import and battery totals | | | | | |
| W1 | WRITE | Add a manual or imported interval reading | | | | | — |
| W2 | WRITE | Correct an existing interval reading | | | | | — |

## Plans

Store the three plan outputs for every query as separate files, for example `plans/R1_run1.txt`, `plans/R1_run2.txt`, and `plans/R1_run3.txt`. The repository does not yet contain timing plans because no database run has been performed here.
