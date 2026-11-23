# Drift Capstone Project — Final Report & Change Log

**Project**: Drift — Solar Balance Monitor  
**Author**: Dwij Saini  
**Date**: November 2026  
**Stack**: Express 5.1, Prisma 6.19, PostgreSQL 18.7, Vanilla ES Modules, CSS Custom Properties  
**Repository**: [dwijsaini/Drift_AP_2026](https://github.com/dwijsaini/Drift_AP_2026)

---

## 1. Executive Summary

This final deliverable transforms the Drift prototype into a production-grade solar balance monitor that adheres strictly to the capstone visual and functional specification. The dashboard now features a dark-first design with an accessible light theme, a sticky 48px topbar, a 220px collapsible sidebar, comprehensive telemetry monitoring, and advanced energy analytics.

All 13 automated unit, integration, and smoke tests pass cleanly. Real query timings were measured against PostgreSQL 18.7 on an Apple Silicon host with 8,760 hourly records and documented in `dbms/05_query_timings.md`.

---

## 2. Summary of Changes Across Phases

### Phase 0: Audit & Baseline Verification
- Verified dual-mode operation: browser-only local preview (`localStorage`) and PostgreSQL API mode (`?mode=api&userId=1`).
- Documented all bugs, contrast failures, responsive issues, and security boundaries in [`docs/AUDIT.md`](AUDIT.md).
- Discovered and addressed local macOS Postgres.app connection requirements and ensured zero test regressions.

### Phase 1: Visual Spec Implementation
- **Theme Tokens**: Dark-first default (`bg #0d1117`, `surface #161b22`, `surface-2 #1f2733`, `border #21262d`, `solar #f0c040`, `consume #58a6ff`, `surplus #3fb950`, `deficit #f85149`) with light theme switch (`bg #f6f8fa`, `surface #ffffff`, `border #d0d7de`, with high-contrast darkened accents).
- **Theme Persistence**: Synced with `localStorage.getItem('drift.theme')`, defaulting to OS `prefers-color-scheme`.
- **Typography**: Inter (400/500/600) for UI controls, DM Mono for all kWh values, numbers, and timestamps with `font-variant-numeric: tabular-nums`.
- **Top Bar**: Sticky 48px bar with solar-yellow brand icon, mode indicator pill, Browser/API segmented switch, command palette shortcut, theme toggle, notification bell with unread badge, and user status chip.
- **Left Sidebar**: 220px fixed navigation grouping Monitor, Analysis, and Data. Collapses into an off-canvas drawer on mobile (`<= 800px`). Bottom active building card contains building picker, timezone, and role badges.
- **Mobile Responsive**: Tested and fully usable at 375px with horizontal table scrolling isolated inside table containers.
- **Stat Cards**: 6-card auto-fill grid (Generated, Consumed, Balance, Coverage, Estimated Grid Cost, Grid Import) with thin progress tracks, deltas, and animated count-up numbers (respecting `prefers-reduced-motion`).
- **Toasts**: Accessible toast notifications matching button action verbs ("Save reading" → "Reading saved", "Import CSV" → "Readings imported").

### Phase 2: Feature Engineering
1. **Notification Center**: Bell icon with live badge tracking telemetry gaps, coverage drops, deficit days, and target progress with read/unread persistence.
2. **Coverage Dial**: Semicircle SVG arc gauge displaying real-time solar coverage percentage with color thresholds.
3. **Peak-Hours Heatmap**: 7x24 grid of hourly balance with tooltips, accessible color scale, and pattern markers for colorblind users.
4. **Building Goals**: Target coverage % and monthly surplus target with projected on-track / at-risk indicators.
5. **Multi-Building Comparison**: Accessible buildings table with 7-day trend sparklines and weakest performer flag.
6. **Tiered Tariff Calculator**: User-editable slab table (units from/to, rate per kWh) + flat-rate alternative, labeled as example slabs.
7. **Readings Table**: Server-side pagination, date bounds (`from`, `to`), search, and column sorting (`sortBy`, `sortDir`), scaling efficiently to 8,760+ rows.
8. **CSV Export & Import**: Date-range filtering and column chooser on export; atomic batch insertion with row-level validation feedback on import.
9. **Rule-Based Insights**: Peak solar generation window, maximum deficit period, missed generation from telemetry gaps.
10. **Environmental Impact**: CO₂ avoided estimate with configurable emission factor (default 0.716 kg CO₂/kWh per India CEA baseline).
11. **Battery Storage What-If**: Scenario slider simulating battery storage capacity to calculate avoided grid draw.
12. **Command Palette (Ctrl/Cmd+K)**: Keyboard-driven search for quick site switching, section navigation, theme toggle, and export.
13. **Printable Weekly Report**: Print-optimized stylesheet (`@media print`) rendering clean 1-page summaries.
14. **Deterministic Realistic Seed Data**: Plausible diurnal solar sine curves with day-to-day weather variation for both residential and commercial buildings (`dbms/seed.sql` and `prisma/seed.js`).
15. **Interactive API Documentation**: Live reference served at `/docs`.

### Phase 3: Quality, Verification & Performance
- **WCAG AA Compliance**: High-contrast ratios across both light and dark themes; visible `:focus-visible` outline rings; full ARIA markup (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-modal`).
- **Automated Tests**: 13 unit, integration, and smoke tests in Node.js test runner passing in ~135ms.
- **DBMS Timing Benchmark**: Real query execution times measured on PostgreSQL 18.7 and recorded in `dbms/05_query_timings.md`.
- **Visual Assets**: Captured dark/light desktop and mobile screenshots and compiled an animated demo GIF in `docs/screenshots/`.

---

## 3. How to Run

### Requirements
- Node.js 20+
- PostgreSQL 15+ (optional for preview mode; required for API mode)

### Mode 1: Browser-Only Preview Mode (No Backend Needed)
```sh
cd frontend
python3 -m http.server 8080
```
Open `http://localhost:8080`. Click **"⚡ Load demo data"** to populate realistic weather-varied test data. All readings and configurations persist in browser `localStorage`.

### Mode 2: Full API-Backed Mode (PostgreSQL + Express)
```sh
# 1. Environment configuration
cp .env.example .env
# Ensure DATABASE_URL in .env points to your local PostgreSQL instance

# 2. Install dependencies & initialize database
npm install
npm run prisma:generate
npm run prisma:migrate:deploy
npm run db:seed

# 3. Run automated tests
npm test

# 4. Start the server
npm run dev
```
Open `http://localhost:3000/?mode=api&userId=1` (or `userId=2` to test Editor/Viewer permissions).  
Visit `http://localhost:3000/docs` to explore interactive API documentation.

---

## 4. Measured vs. Estimated Values

To maintain complete academic and engineering integrity:

| Metric | Classification | Source / Methodology |
|---|---|---|
| **DBMS Query Latency (R1–R4, W1–W2)** | **Measured** | Real timings from 3 consecutive runs using `EXPLAIN (ANALYZE, BUFFERS)` on PostgreSQL 18.7 running on Apple Silicon Mac (`dbms/05_query_timings.md`). |
| **Test Suite Execution (135ms)** | **Measured** | Output of `node --test` across 13 test suites. |
| **Grid Cost (₹)** | **Estimated** | Mathematical calculation: recorded `gridImportKwh` $\times$ rate/slabs. Not an official utility DISCOM bill; excludes fixed charges and meter rents. |
| **CO₂ Avoided (kg)** | **Estimated** | Calculated as total solar generation (kWh) $\times$ grid emission factor (0.716 kg CO₂/kWh from CEA CO₂ Baseline Database Version 19). |
| **Battery Storage Offset** | **Estimated (Scenario)** | Temporary simulation based on recorded diurnal deficit and surplus curves. Never committed to database. |
| **Demo Data Profile** | **Generated Demo Data** | Sinusoidal solar generation with pseudo-random weather modulation. Clearly tagged with `[DEMO DATA]` badge. |

---

## 5. Known Limitations & Future Considerations

1. **Development Identity Header**: `X-User-Id` is a development identity mechanism designed for class evaluation. A production deployment requires upstream OAuth2 / JWT authentication middleware.
2. **Timezone Interpolation**: Interval gap detection assumes hourly reporting intervals. Sub-hourly telemetry (e.g., 15-minute smart meter feeds) would require dynamic interval parameterization.
3. **Complex Utility Tariffs**: The slab calculator models tiered energy charges; real-world industrial bills may include maximum demand penalties (kVA) and power factor surcharges.
