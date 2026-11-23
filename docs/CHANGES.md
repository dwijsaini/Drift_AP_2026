# Drift changes report

Updated 2026-11-23.

## Included in this update

- Dashboard shell refresh with browser/API links, persisted light/dark theme, focus outlines, responsive layout, navigation groups, notification center, and command palette.
- Energy summary cards, coverage gauge, combined generation/consumption/balance chart, hourly weekday heatmap, data quality warnings, rules-based insights, CO₂ estimate, monthly goals, what-if battery scenario, and example slab tariff calculator.
- Reading table search, date range, sorting, and server-side pagination. Page size is bounded to 100; the dashboard requests 50 rows per page.
- CSV export date range and column chooser; preview mode import/export; deterministic weather-varied solar seed values; printable report styles; demo-data generation.
- `/docs` API reference and updated `docs/api.md` and README instructions.

## Verification

- `npm test`: 7 passed, 0 failed, 0 skipped on the local PostgreSQL database.
- JavaScript syntax checks passed for the dashboard, adapter, routes, and server.
- Local HTTP checks returned 200 for the API dashboard, browser preview, `/docs`, and `/health`.
- A live paginated readings request returned the requested page and `hasMore` metadata.

## Estimates and limitations

- CO₂ and tariff outputs are estimates. The emission factor and its source are editable; example tariff slabs are not official DISCOM rates.
- Battery and solar planner outputs are scenarios and do not modify saved readings.
- Monthly goals and theme preferences are stored in browser local storage per selected building, not in PostgreSQL; they are specific to that browser.
- The printable output uses the browser print dialog; no PDF artifact is generated.
- Browser automation was unavailable, so pixel-level desktop/mobile screenshots, GIF capture, and console-error inspection were not verified. Review at 375px and with keyboard/screen-reader tools before presenting.
- Notifications and insight rules are heuristic summaries from available readings. They are not utility alerts or forecasts.
