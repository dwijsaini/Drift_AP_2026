# Drift Capstone Audit (Phase 0)

**Date**: November 2026  
**Auditor**: Antigravity Assistant  
**Target Environment**: Node.js v24 (>=20), PostgreSQL 18.7, Express 5.1, Prisma 6.19, Vanilla ES Modules  
**Modes Tested**:
1. Browser-only preview mode (`http://localhost:3000/` and `python3 -m http.server 8080`)
2. API-backed mode (`http://localhost:3000/?mode=api&userId=1` and `?mode=api&userId=2`)

---

## 1. Executive Summary

Drift's core mathematical logic (`computeEnergyMetrics`, `withCompleteness`, and `estimateGridCost`) and Prisma database schema are structurally sound and well-tested (`npm test` passes 7/7 automated tests). Role-based access control rules (Owner vs. Editor vs. Viewer) are strictly enforced in SQL joins and HTTP middleware.

However, the existing front-end dashboard suffers from critical responsive design flaws (e.g., the building selector disappearing entirely on mobile), significant WCAG AA contrast failures (text as small as 8px with contrast as low as 2.4:1), lack of dark theme support, lack of skeleton/loading feedback, state leaks between building switches, and unstyled blocking browser dialogs (`window.prompt` / `window.confirm`). In addition, the readings table lacks pagination, sorting, search, and range filtering, making it impractical for large interval datasets (such as a full year of 8,760 hourly readings).

---

## 2. What Works Cleanly

- **Dual-Mode Architecture & State Separation**:
  - `frontend/data-adapter.js` cleanly abstracts storage mechanisms, using browser `localStorage` (`drift.frontend-preview.v1`) in preview mode and Express REST endpoints (`/api/...`) in API mode.
  - Preview mode functions with zero backend or network dependencies.
- **Accurate Mathematical Formulations**:
  - Balance ($E_{\text{balance}} = E_{\text{gen}} - E_{\text{con}}$), gap ($E_{\text{gap}} = E_{\text{con}} - E_{\text{gen}}$), and solar coverage percentage ($\min(E_{\text{gen}}, E_{\text{con}}) / E_{\text{con}} \times 100$) are calculated properly with explicit protection against division-by-zero.
- **Multi-Tenant Tenant Isolation & RBAC**:
  - Role enforcement is validated both at the API level and UI level.
  - For user `userId=2` (Priya Mehta), navigating to **Drift Demo Home** (`VIEWER`) disables all reading form controls, hides or disables destructive actions, disables CSV import, and marks table actions as "View only".
  - Switching to **Green Office Tower** (`EDITOR`) unlocks reading creation, CSV import, and edit/delete capabilities.
  - Unauthorized users cannot access buildings without an explicit `building_members` record.
- **Gap Detection & Timezone Awareness**:
  - Hourly gap detection accounts for timezone offsets and calendar boundaries (using PostgreSQL `generate_series` with `AT TIME ZONE`).
  - Alert triggers reliably if expected intervals are missing.
- **Dynamic What-If Planner**:
  - Client-side solar multiplier recalculates balance and projected generation instantaneously without modifying saved records.
- **High-DPI Canvas Rendering**:
  - The custom canvas chart respects `window.devicePixelRatio` to prevent pixelation on Retina displays.

---

## 3. Real Bugs & Logical Flaws Verified

1. **CRITICAL: Building Selector Inaccessible on Mobile (`<= 780px`)**:
   - In `styles.css` under `@media(max-width:780px)`:
     ```css
     .workspace-label, .building-picker, .sidebar-bottom { display: none; }
     ```
   - `#building-select` is nested inside `.building-picker`. On screen widths under 780px (including standard 375px mobile viewports), the building selector is completely removed from the DOM layout. Users on mobile devices cannot switch buildings in API mode.
2. **Dangling Edit State Across Building Switch**:
   - If a user clicks "Edit" on a reading in Building 1, the internal `editing` variable is populated. If the user then switches buildings to Building 2, `editing` is not cleared. When the form is submitted, it sends a `PATCH` request targeting Building 1's `readingId` against Building 2's endpoint (`/api/buildings/2/readings/:id1`), causing a 404 or state corruption.
3. **Typography Degradation & Missing Font Imports**:
   - `styles.css` declares `font-family: "DM Sans"` and `Manrope`, but `index.html` lacks `<link>` tags to Google Fonts or local font declarations. On any machine lacking these fonts installed locally in the OS, typography silently degrades to generic sans-serif or Times New Roman.
4. **Chart X-Axis Label Repetition in "All Readings" Mode**:
   - `drawChart` formats timestamps using only the date portion (`YYYY-MM-DD`). In hourly mode or "All readings", all 8 rendered bars display the identical date string (e.g. `Oct 1, Oct 1, Oct 1...`), rendering the X-axis completely uninformative.
5. **Disconnected Form Error Placement**:
   - `#app-error` is anchored at the top of the main content column. When a user is focused on the reading form near the bottom of the page, form submission errors (such as invalid date order or overlapping periods) render at the top off-screen without scrolling or visual indication near the submit button.
6. **Leaked Comparison Results**:
   - Clicking "Compare buildings" mounts a table into `#comparison-results`. This DOM element is never cleared when switching active buildings or changing date scopes.
7. **`localStorage` User ID Persistence**:
   - `params.get('userId')` in `data-adapter.js` does not save back to `localStorage.setItem('drift.api-user-id', ...)`, meaning navigating without query parameters drops the user back to unauthenticated or stale state.
8. **Native Modal Blockers**:
   - Using synchronous, non-accessible browser `window.prompt()` for building creation and `window.confirm()` for record deletion disrupts keyboard flow, blocks the UI thread, and provides poor mobile UX.

---

## 4. Missing Empty, Loading, and Error States

1. **No Loading Skeletons or Busy Spinners**:
   - In API mode, initial page load briefly flashes empty preview default values (`0.0 kWh`, "My home", "Saved on this device") before API data resolves.
   - Switching buildings causes abrupt UI freezes while fetching readings and summaries, without visual indication of network activity.
   - "Compare buildings" has no progress state or spinner; clicking it leaves the user wondering if the button registered.
2. **Double-Submit Vulnerability**:
   - Buttons (`#reading-submit`, `#manage-building`, `#import-csv`) remain active during asynchronous network operations, allowing rapid double-clicks to fire duplicate requests.
3. **Empty State Deficiencies**:
   - When a building has zero readings, the What-If planner displays `Projected balance: 0.0 kWh (0.0 kWh generation)` instead of explaining that readings must first be logged.
   - The summary stat cards show `0.0 kWh` instead of an explicit empty/null indicator.
4. **Offline Resilience**:
   - If the network drops while in API mode, actions fail silently or throw raw errors without offering retry actions or informing the user of offline status.

---

## 5. Accessibility and Usability Gaps

1. **Severe WCAG AA Contrast Failures**:
   - Column headers (`th`): `#929c94` on `#ffffff` has a contrast ratio of **2.7:1** (fails WCAG AA 4.5:1 minimum).
   - Eyebrows & Workspace label: `#89938b` on `#ffffff` has a contrast ratio of **3.0:1**.
   - Metric notes & footer (`.card-note`, `footer`): `#8a958d` / `#9aa49d` has contrast ratios between **2.4:1 and 3.2:1**.
   - Muted body text (`--muted: #748078`): **3.8:1**.
2. **Illegible Font Sizes**:
   - Table headers (`th`), `.prototype-tag`, and `.building-picker small` are rendered at **8px**, violating accessibility minimums (standard minimum 12px; hard minimum 10px).
   - `.card-top`, `.chart-labels`, and `footer` are set to **9px**.
3. **Missing Keyboard Focus Ring**:
   - Interactive buttons (`.button`, `.text-button`, `#clear-data`), selects, and range sliders lack distinct `:focus-visible` outlines.
   - Form controls have `outline: none` without replacement custom focus treatments.
4. **Screen Reader (ARIA) Omissions**:
   - Table action buttons ("Edit", "Delete") repeat identical text across dozens of rows without `aria-label` differentiating which time period is targeted.
   - The canvas chart lacks an accessible table fallback or `aria-describedby` reference.
   - Segmented controls and tabs lack `role="tablist"` / `role="tab"` and `aria-selected` attributes.
   - On screens `<= 780px`, `.local-badge { font-size: 0; }` hides the badge text, leaving a solitary unlabelled colored dot.

---

## 6. Security & Performance Audit

1. **Unbounded Readings Query (`GET /api/buildings/:buildingId/readings`)**:
   - The existing endpoint retrieves all rows matching the date filter without `limit` or `offset`. In a database populated with 8,760 hourly readings (1 year), the endpoint serializes the entire dataset into a multi-megabyte JSON response, causing client memory strain and DOM thrashing.
   - *Fix needed*: Add server-side pagination (`page`, `pageSize`), column sorting (`sortField`, `sortDir`), date filtering, and search.
2. **Inefficient CSV Import Transaction**:
   - In `src/routes.js`, `POST /buildings/:buildingId/readings.csv` executes `prisma.$transaction(parsed.map(r => prisma.energyPeriod.create(...)))`. For 10,000 rows, this fires 10,000 distinct SQL INSERT statements over the Prisma connection, risking transaction timeout and excessive memory usage.
3. **Timezone Validation Gap**:
   - In `POST /api/buildings`, `timezone` is accepted as any string up to 100 characters. If an invalid timezone is submitted, subsequent queries executing `AT TIME ZONE` will fail with PostgreSQL errors.
4. **Development Identity Clarification**:
   - `X-User-Id` is strictly a development identity mechanism. It must remain clearly documented as such, with input validation ensuring BigInt positivity.

---

## 7. Visual Spec Gaps Against Redesign Requirements

The current dashboard is a prototype light-only layout with olive-green and salmon tones. The target redesign requires:
- Product-grade dark-first dashboard with high-contrast light theme switch.
- Tokens: dark `bg #0d1117`, `surface #161b22`, `surface-2 #1f2733`, `border #21262d`, `solar #f0c040`, `consume #58a6ff`, `surplus #3fb950`, `deficit #f85149`.
- Typography: Inter (400/500/600) for UI, DM Mono for all kWh values, numbers, and timestamps with `tabular-nums`.
- Sticky 48px topbar with brand mark, mode pill, Browser/API switch, theme toggle, notification bell with unread badge, and user chip.
- 220px left sidebar with Monitor, Analysis, Data groupings and collapsible drawer for mobile `<= 800px`.
- High-density stat grid with progress bars and count-up animations.
- Peak-hours heatmap (7x24 grid), coverage dial, goal tracking, tiered tariff calculator, sparklines, CSV export filters, insights rule engine, and printable weekly report.
