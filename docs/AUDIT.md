# Drift audit

Audit date: 2026-11-23. This records checks run against the current checkout before the requested redesign.

## Verified

- `npm test`: 6 passed, 0 failed, 1 skipped. The skipped case is the PostgreSQL integration test; Prisma could not connect to `localhost:5432`.
- Browser preview static server: `frontend/` served on port 8080; `/` and `/app.js` both returned HTTP 200. This verifies delivery only, not browser rendering or console behavior.
- The code contains a local-storage preview adapter, an API adapter, role-based disabling of edit controls for viewers, a CSV parser, and server validation. The API identity is `X-User-Id`, explicitly documented as development-only.
- The database-backed dashboard could not be verified in this audit because PostgreSQL was unreachable. Migrations, seeding, API mode, and database health therefore remain unverified here.

## Issues found by inspection

- The current visual system is light-only and does not include the requested theme preference, theme control, focus treatment, responsive 375px layout, or navigation structure.
- The page lacks explicit loading and offline states. A request error is shown in one global message, so individual panels do not explain their own state.
- Existing completeness alerts cover missing hourly slots in summary data. The readings view does not offer server-side paging, searching, sorting, or date filters.
- CSV export currently uses the whole accessible reading set; there is no visible range or column chooser. Import reports a general error rather than a per-row review table.
- There is no notification center, hourly heatmap, monthly goal persistence on the server, tiered tariff, carbon estimate, battery scenario, print report, command palette, or generated demo-data action in the audited baseline.
- Automated visual inspection and browser console capture were not available in this run. No console error or visual defect is asserted without that evidence.

## Security and accessibility notes

- `X-User-Id` is not production authentication; do not expose this demo configuration as a production service.
- Zod schemas and route membership checks are present. A full authorization and input-security review still needs API tests against a live database.
- Keyboard and screen-reader behavior, WCAG contrast in both themes, and narrow-screen overflow need manual browser verification after the redesign.

## Audit limits

No migration or seed was run because the configured database server was unreachable. Existing browser storage was not cleared. Findings above distinguish code inspection from live behavior.
