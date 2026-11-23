# Drift query timing report

**Environment**:
- **Database Engine**: PostgreSQL 18.7 (Postgres.app)
- **Host Architecture**: Apple Silicon (aarch64-apple-darwin23.6.0)
- **Dataset**: `drift_dbms` initialized via `dbms/03_schema.sql` and seeded via `dbms/seed.sql` (8,760 hourly interval readings for 2025 across 365 days; 1 demo user, 1 building).
- **Execution Methodology**: Each query was executed 3 consecutive times using `EXPLAIN (ANALYZE, BUFFERS)`. Execution times in milliseconds were extracted from the plan buffers, and the arithmetic mean was computed. Write queries (`W1`, `W2`) were wrapped in transactions with explicit `ROLLBACK` to guarantee identical starting states across all runs. All raw plan outputs are archived in `dbms/plans/`.

| Query | Type | What it does | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Average (ms) | Scan type |
|---|---|---|---:|---:|---:|---:|---|
| R1 | READ | Daily generated/consumed balance and coverage | 9.477 | 8.477 | 7.601 | 8.518 | Seq Scan |
| R2 | READ | Monthly energy gap and change from prior month | 5.761 | 5.238 | 5.015 | 5.338 | Seq Scan |
| R3 | READ | Weekly generated/consumed balance and coverage | 5.236 | 4.650 | 4.893 | 4.926 | Seq Scan |
| R4 | READ | Daily grid-import and battery totals | 4.155 | 3.941 | 3.817 | 3.971 | Seq Scan |
| W1 | WRITE | Add a manual or imported interval reading | 0.312 | 0.260 | 0.264 | 0.279 | — |
| W2 | WRITE | Correct an existing interval reading | 0.153 | 0.127 | 0.127 | 0.136 | — |

## Plans

Raw `EXPLAIN (ANALYZE, BUFFERS)` outputs for each individual run are saved in `dbms/plans/`:
- `dbms/plans/R1_run1.txt`, `dbms/plans/R1_run2.txt`, `dbms/plans/R1_run3.txt`
- `dbms/plans/R2_run1.txt`, `dbms/plans/R2_run2.txt`, `dbms/plans/R2_run3.txt`
- `dbms/plans/R3_run1.txt`, `dbms/plans/R3_run2.txt`, `dbms/plans/R3_run3.txt`
- `dbms/plans/R4_run1.txt`, `dbms/plans/R4_run2.txt`, `dbms/plans/R4_run3.txt`
- `dbms/plans/W1_run1.txt`, `dbms/plans/W1_run2.txt`, `dbms/plans/W1_run3.txt`
- `dbms/plans/W2_run1.txt`, `dbms/plans/W2_run2.txt`, `dbms/plans/W2_run3.txt`
