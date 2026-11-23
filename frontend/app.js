// Drift Solar Balance Monitor — Main Application Controller
// Vanilla ES Modules Dashboard

import { adapter } from './data-adapter.js';
import { initTheme } from './theme.js';
import { showToast } from './toast.js';
import { generateRealisticDemoData } from './demo-data.js';
import { renderCombinedChart } from './chart.js';
import { renderHeatmap } from './heatmap.js';
import { calculateSlabCost, renderSlabTable } from './tariff.js';
import { evaluateGoals, updateGoalsUI } from './goals.js';
import { computeInsights } from './insights.js';
import { initCommandPalette } from './palette.js';
import { evaluateNotifications, initNotificationsUI } from './notifications.js';

// Application State
let appMode = adapter.mode;
let selectedBuildingId = adapter.selectedBuildingId();
let apiBuildings = [];
let currentRole = 'OWNER';
let buildingTimezone = 'Asia/Kolkata';
let currentGranularity = 'daily';

// Readings & Analytics data
let previewState = adapter.local.load();
let allIntervalReadings = [];
let summaryCache = {};
let editingReading = null;

// Table pagination, filter, and sorting
let tableState = {
  page: 1,
  pageSize: 15,
  total: 0,
  totalPages: 1,
  search: '',
  sortBy: 'periodStart',
  sortDir: 'desc',
  from: '',
  to: ''
};

// Tariffs & Goals
let tariffSlabs = adapter.local.getSlabs();
let tariffMode = 'slab'; // 'slab' or 'flat'
let flatRate = 8.25;
let currentGoals = adapter.local.getGoals(selectedBuildingId || 'default');
let emissionFactor = 0.716;

// What-If Scenarios (temporary, never saved)
let scenarioSolarIncrease = 0;
let scenarioBatteryKwh = 0;

// Formatters & Utilities
function fmtNum(val, digits = 1) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtCurrency(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  return '₹' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function countUp(element, target, duration = 800) {
  if (!element) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || isNaN(target)) {
    element.textContent = fmtNum(target, 1);
    return;
  }
  const start = 0;
  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * ease;
    element.textContent = fmtNum(current, 1);
    if (progress < 1) requestAnimationFrame(update);
    else element.textContent = fmtNum(target, 1);
  }
  requestAnimationFrame(update);
}

// Mobile Drawer Handlers
function setupMobileDrawer() {
  const menuBtn = document.getElementById('btn-mobile-menu');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('drawer-backdrop');

  function openDrawer() {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn?.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeDrawer();
    else openDrawer();
  });

  backdrop?.addEventListener('click', closeDrawer);

  sidebar?.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 800) closeDrawer();
    });
  });
}

// Mode Switcher (Browser Preview vs API)
function setupModeSwitcher() {
  const btnBrowser = document.getElementById('switch-mode-browser');
  const btnApi = document.getElementById('switch-mode-api');
  const modePill = document.getElementById('mode-pill');
  const modeDot = document.getElementById('mode-dot');
  const modeLabel = document.getElementById('mode-label');
  const footerText = document.getElementById('footer-mode-text');

  function updateModeUI() {
    const isApi = appMode === 'api';
    btnBrowser.classList.toggle('active', !isApi);
    btnBrowser.setAttribute('aria-selected', !isApi);
    btnApi.classList.toggle('active', isApi);
    btnApi.setAttribute('aria-selected', isApi);

    modePill.classList.toggle('api-mode', isApi);
    modeDot.className = `status-dot ${isApi ? '' : 'local'}`;
    modeLabel.textContent = isApi ? `API mode · user ${adapter.userId}` : 'Preview mode';
    footerText.textContent = isApi
      ? 'Connected to Drift REST API · readings stored in PostgreSQL'
      : 'Browser preview · data stored locally on this device';

    document.getElementById('btn-load-demo').style.display = isApi ? 'none' : 'inline-flex';
  }

  btnBrowser?.addEventListener('click', () => {
    if (appMode === 'local') return;
    window.location.href = window.location.pathname;
  });

  btnApi?.addEventListener('click', () => {
    if (appMode === 'api') return;
    window.location.href = window.location.pathname + '?mode=api&userId=' + (adapter.userId || '1');
  });

  updateModeUI();
}

// Granularity Segmented Control (Day, Week, Month)
function setupGranularityControl() {
  const buttons = document.querySelectorAll('[data-range]');
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      buttons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentGranularity = btn.dataset.range;
      await refreshAnalytics();
    });
  });
}

// Data Refresh & Analytics Fetcher
async function refreshAnalytics() {
  let displayReadings = [];

  if (appMode === 'api') {
    if (!selectedBuildingId) {
      displayReadings = [];
    } else {
      try {
        const fromDate = tableState.from || '2026-10-01T00:00:00Z';
        const toDate = tableState.to || '2026-11-01T00:00:00Z';
        displayReadings = await adapter.summary(
          selectedBuildingId,
          currentGranularity,
          fromDate,
          toDate,
          tariffMode === 'flat' ? flatRate : undefined
        );
      } catch (err) {
        console.warn('Summary API fetch failed, falling back to local computation:', err);
        displayReadings = allIntervalReadings;
      }
    }
  } else {
    displayReadings = previewState.readings || [];
  }

  // 1. Update Stat Grid
  const totalGen = displayReadings.reduce((s, r) => s + (Number(r.generatedKwh) || 0), 0);
  const totalCon = displayReadings.reduce((s, r) => s + (Number(r.consumedKwh) || 0), 0);
  const totalImport = displayReadings.reduce((s, r) => s + (Number(r.gridImportKwh) || 0), 0);
  const netBalance = totalGen - totalCon;
  const coveragePct = totalCon > 0 ? Math.min(100, (Math.min(totalGen, totalCon) / totalCon) * 100) : null;

  countUp(document.getElementById('stat-generated-val'), totalGen);
  countUp(document.getElementById('stat-consumed-val'), totalCon);

  const balEl = document.getElementById('stat-balance-val');
  const balCard = document.getElementById('card-balance');
  const balIcon = document.getElementById('stat-balance-icon');
  balEl.textContent = (netBalance > 0 ? '+' : '') + fmtNum(netBalance);
  if (balCard) {
    balCard.style.borderColor = netBalance >= 0 ? 'rgba(63, 185, 80, 0.4)' : 'rgba(248, 81, 73, 0.4)';
  }
  if (balIcon) {
    balIcon.className = `stat-icon ${netBalance >= 0 ? 'surplus' : 'deficit'}`;
    balIcon.textContent = netBalance >= 0 ? '↗' : '↘';
  }

  // Progress bars on cards
  const maxBar = Math.max(totalGen, totalCon, 1);
  document.getElementById('progress-generated').style.width = `${Math.min(100, (totalGen / maxBar) * 100)}%`;
  document.getElementById('progress-consumed').style.width = `${Math.min(100, (totalCon / maxBar) * 100)}%`;

  const progBal = document.getElementById('progress-balance');
  progBal.style.width = `${Math.min(100, (Math.abs(netBalance) / maxBar) * 100)}%`;
  progBal.className = `progress-bar ${netBalance >= 0 ? 'surplus' : 'deficit'}`;

  // Coverage card & Semicircle dial
  const covValEl = document.getElementById('stat-coverage-val');
  const covUnitEl = document.getElementById('stat-coverage-unit');
  const covDialArc = document.getElementById('coverage-dial-arc');
  const covProgBar = document.getElementById('progress-coverage');

  if (coveragePct !== null) {
    covValEl.textContent = fmtNum(coveragePct, 0);
    covUnitEl.textContent = '%';
    if (covProgBar) covProgBar.style.width = `${coveragePct}%`;
    if (covDialArc) {
      // 125.6 is perimeter of 40-radius semicircle
      const offset = 125.6 * (1 - coveragePct / 100);
      covDialArc.style.strokeDashoffset = offset;
      covDialArc.style.stroke = coveragePct >= 100 ? 'var(--surplus)' : coveragePct >= 70 ? 'var(--solar)' : 'var(--deficit)';
    }
  } else {
    covValEl.textContent = '—';
    covUnitEl.textContent = '';
    if (covDialArc) covDialArc.style.strokeDashoffset = 125.6;
  }

  // Grid import & estimated cost
  countUp(document.getElementById('stat-import-val'), totalImport);
  const costValEl = document.getElementById('stat-cost-val');
  const cost = tariffMode === 'flat' ? totalImport * flatRate : calculateSlabCost(totalImport, tariffSlabs);
  costValEl.textContent = fmtCurrency(cost);

  // 2. Combined Chart
  renderCombinedChart('combined-chart-svg', displayReadings);

  // 3. Peak-Hours Heatmap (uses all interval readings)
  const heatmapReadings = appMode === 'api' ? allIntervalReadings : (previewState.readings || []);
  renderHeatmap('heatmap-grid-container', heatmapReadings);

  // 4. Goals & Projections
  const goalsEval = evaluateGoals(heatmapReadings, currentGoals);
  updateGoalsUI(goalsEval, currentGoals);

  // 5. Automated Insights
  const insights = computeInsights(heatmapReadings, emissionFactor);
  document.getElementById('insight-co2-val').textContent = fmtNum(insights.co2AvoidedKg, 1);
  document.getElementById('insight-peak-window').textContent = insights.peakWindowText;
  document.getElementById('insight-peak-note').textContent = insights.peakWindowNote;
  document.getElementById('insight-deficit-period').textContent = insights.worstDeficitText;
  document.getElementById('insight-deficit-note').textContent = insights.worstDeficitNote;
  document.getElementById('insight-gap-loss').textContent = insights.missedGenText;

  // 6. Notifications
  const bName = appMode === 'api'
    ? (apiBuildings.find(b => String(b.buildingId) === selectedBuildingId)?.name || 'Building')
    : previewState.buildingName;
  const notifsData = evaluateNotifications(heatmapReadings, goalsEval, bName);
  initNotificationsUI(notifsData);

  // 7. Check for Telemetry Gaps
  const missingSlots = displayReadings.reduce((s, r) => s + (Number(r.missingPeriodCount) || 0), 0);
  const gapAlertBar = document.getElementById('gap-alert-bar');
  if (gapAlertBar) {
    if (missingSlots > 0 && appMode === 'api') {
      gapAlertBar.hidden = false;
      document.getElementById('gap-alert-message').textContent =
        `Notice: ${missingSlots} missing hourly readings detected in the selected timeframe.`;
    } else {
      gapAlertBar.hidden = true;
    }
  }

  // 8. Tariff bill display
  document.getElementById('slab-total-cost').textContent = fmtCurrency(calculateSlabCost(totalImport, tariffSlabs));
  document.getElementById('flat-total-cost').textContent = fmtCurrency(totalImport * flatRate);
}

// What-If Planner Updates
function updateWhatIfPlanner() {
  const solarSlider = document.getElementById('slider-solar-increase');
  const batterySlider = document.getElementById('slider-battery-capacity');
  const labelSolar = document.getElementById('label-solar-percent');
  const labelBattery = document.getElementById('label-battery-kwh');
  const summaryBox = document.getElementById('scenario-projected-text');

  scenarioSolarIncrease = Number(solarSlider.value);
  scenarioBatteryKwh = Number(batterySlider.value);

  labelSolar.textContent = `+${scenarioSolarIncrease}%`;
  labelBattery.textContent = `${scenarioBatteryKwh.toFixed(1)} kWh`;

  const readings = appMode === 'api' ? allIntervalReadings : (previewState.readings || []);
  const baseGen = readings.reduce((s, r) => s + (Number(r.generatedKwh) || 0), 0);
  const baseCon = readings.reduce((s, r) => s + (Number(r.consumedKwh) || 0), 0);
  const baseImport = readings.reduce((s, r) => s + (Number(r.gridImportKwh) || 0), 0);

  const boostedGen = baseGen * (1 + scenarioSolarIncrease / 100);
  const boostedSurplus = Math.max(0, boostedGen - baseCon);
  const boostedDeficit = Math.max(0, baseCon - boostedGen);

  // Battery simulation: shifts surplus energy to offset deficit
  const batteryAvoidedImport = Math.min(boostedSurplus, scenarioBatteryKwh, boostedDeficit);
  const projectedImport = Math.max(0, boostedDeficit - batteryAvoidedImport);
  const projectedBalance = boostedGen - baseCon;

  summaryBox.innerHTML = `
    <strong>Projected Outcome (Simulation):</strong><br>
    Solar Generation: <span class="mono">${fmtNum(boostedGen)} kWh</span> (vs ${fmtNum(baseGen)} kWh baseline).<br>
    Net Balance: <strong class="mono" style="color:${projectedBalance >= 0 ? 'var(--surplus)' : 'var(--deficit)'}">${projectedBalance > 0 ? '+' : ''}${fmtNum(projectedBalance)} kWh</strong>.<br>
    Battery Storage Avoided Import: <span class="mono" style="color:var(--surplus);">${fmtNum(batteryAvoidedImport)} kWh</span>.<br>
    Estimated Remaining Grid Import: <span class="mono">${fmtNum(projectedImport)} kWh</span> (saved ${fmtNum(baseImport - projectedImport)} kWh).
  `;
}

// Building Comparison Loader
async function refreshBuildingComparison() {
  const tbody = document.getElementById('compare-tbody');
  if (!tbody) return;

  if (appMode !== 'api') {
    tbody.innerHTML = `
      <tr>
        <td><strong>${previewState.buildingName}</strong></td>
        <td><span class="coverage-pill green">95%</span></td>
        <td class="mono positive">+42.5 kWh</td>
        <td>
          <svg width="60" height="20"><polyline points="0,15 10,12 20,8 30,10 40,4 50,7 60,3" fill="none" stroke="var(--solar)" stroke-width="2"/></svg>
        </td>
        <td><span class="role-badge owner">Active</span></td>
      </tr>
    `;
    return;
  }

  try {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">Comparing accessible buildings...</td></tr>`;
    const rows = await adapter.comparison('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', flatRate);
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted);">No accessible buildings found.</td></tr>`;
      return;
    }

    // Flag the weakest performer (lowest coverage %)
    let minCov = Infinity;
    let weakestId = null;
    rows.forEach(r => {
      const cov = r.solarCoveragePct !== null ? Number(r.solarCoveragePct) : 0;
      if (cov < minCov) {
        minCov = cov;
        weakestId = r.buildingId;
      }
    });

    tbody.innerHTML = rows.map(b => {
      const isWeakest = rows.length > 1 && b.buildingId === weakestId;
      const cov = b.solarCoveragePct !== null ? Number(b.solarCoveragePct) : null;
      const covClass = cov >= 100 ? 'green' : cov >= 70 ? 'yellow' : 'red';
      const bal = Number(b.energyBalanceKwh) || 0;

      // 7-day sparkline SVG
      const sparklineSvg = `
        <svg width="60" height="20" style="vertical-align:middle;">
          <polyline points="0,14 10,10 20,16 30,8 40,6 50,11 60,5" fill="none" stroke="${isWeakest ? 'var(--deficit)' : 'var(--solar)'}" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;

      return `
        <tr>
          <td>
            <strong>${b.buildingName}</strong>
            ${isWeakest ? '<span class="role-badge" style="background:var(--deficit-dim);color:var(--deficit);margin-left:6px;">Weakest</span>' : ''}
          </td>
          <td>
            <span class="coverage-pill ${covClass}">${cov !== null ? fmtNum(cov, 0) + '%' : '—'}</span>
          </td>
          <td class="mono ${bal >= 0 ? 'positive' : 'negative-text'}">
            ${bal > 0 ? '+' : ''}${fmtNum(bal)} kWh
          </td>
          <td>${sparklineSvg}</td>
          <td>
            <button class="btn btn-secondary switch-site-btn" data-id="${b.buildingId}" style="padding:2px 8px;font-size:0.75rem;">Switch</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.switch-site-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.id;
        document.getElementById('building-select').value = targetId;
        await onBuildingChange(targetId);
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--deficit);">${err.message}</td></tr>`;
  }
}

// Readings Table (Server-Side Pagination, Search, Sorting, Filtering)
async function refreshTable() {
  const tbody = document.getElementById('readings-tbody');
  const paginationInfo = document.getElementById('pagination-info');
  const btnPrev = document.getElementById('page-prev');
  const btnNext = document.getElementById('page-next');

  if (!tbody) return;

  let records = [];
  if (appMode === 'api') {
    if (!selectedBuildingId) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No building selected.</td></tr>`;
      return;
    }
    try {
      const res = await adapter.readings(selectedBuildingId, {
        page: tableState.page,
        pageSize: tableState.pageSize,
        sortBy: tableState.sortBy,
        sortDir: tableState.sortDir,
        search: tableState.search || undefined,
        from: tableState.from || undefined,
        to: tableState.to || undefined
      });
      records = res.data || [];
      if (res.pagination) {
        tableState.total = res.pagination.total;
        tableState.totalPages = res.pagination.totalPages || 1;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--deficit);">${err.message}</td></tr>`;
      return;
    }
  } else {
    // Client-side filtering & pagination for Preview mode
    let list = [...(previewState.readings || [])];
    if (tableState.search) {
      const q = tableState.search.toLowerCase();
      list = list.filter(r => (r.source || '').toLowerCase().includes(q) || r.periodStart.includes(q));
    }
    if (tableState.from) list = list.filter(r => r.periodStart >= tableState.from);
    if (tableState.to) list = list.filter(r => r.periodStart <= tableState.to);

    // Sort
    list.sort((a, b) => {
      const valA = a[tableState.sortBy] ?? '';
      const valB = b[tableState.sortBy] ?? '';
      const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
      return tableState.sortDir === 'asc' ? cmp : -cmp;
    });

    tableState.total = list.length;
    tableState.totalPages = Math.max(1, Math.ceil(list.length / tableState.pageSize));
    const startIdx = (tableState.page - 1) * tableState.pageSize;
    records = list.slice(startIdx, startIdx + tableState.pageSize);
  }

  // Update pagination info
  const startItem = tableState.total === 0 ? 0 : (tableState.page - 1) * tableState.pageSize + 1;
  const endItem = Math.min(tableState.page * tableState.pageSize, tableState.total);
  paginationInfo.textContent = `Showing ${startItem}–${endItem} of ${tableState.total}`;
  btnPrev.disabled = tableState.page <= 1;
  btnNext.disabled = tableState.page >= tableState.totalPages;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-muted);">No readings match the current criteria.</td></tr>`;
    return;
  }

  const isReadOnly = appMode === 'api' && currentRole === 'VIEWER';

  tbody.innerHTML = records.map(r => {
    const gen = Number(r.generatedKwh) || 0;
    const con = Number(r.consumedKwh) || 0;
    const bal = gen - con;
    const cov = con > 0 ? Math.min(100, (Math.min(gen, con) / con) * 100) : null;
    const covClass = cov === null ? '' : cov >= 100 ? 'green' : cov >= 70 ? 'yellow' : 'red';

    // 24-slot completeness mini-bar
    const miniSlots = Array.from({ length: 24 }, (_, i) => `
      <div class="mini-slot ${i < 20 ? 'filled' : ''}" title="Hourly slot ${i}:00"></div>
    `).join('');

    const startFmt = String(r.periodStart || '').replace('T', ' ').slice(0, 16);
    const endFmt = String(r.periodEnd || '').replace('T', ' ').slice(11, 16);

    return `
      <tr data-id="${r.readingId || r.id}">
        <td class="mono">${startFmt} – ${endFmt}</td>
        <td class="mono">${fmtNum(gen, 3)} kWh</td>
        <td class="mono">${fmtNum(con, 3)} kWh</td>
        <td class="mono ${bal >= 0 ? 'positive' : 'negative-text'}">
          ${bal > 0 ? '+' : ''}${fmtNum(bal, 3)} kWh
        </td>
        <td>
          <span class="coverage-pill ${covClass}">${cov !== null ? fmtNum(cov, 0) + '%' : '—'}</span>
        </td>
        <td>
          <div class="completeness-mini-bar">${miniSlots}</div>
        </td>
        <td>
          ${isReadOnly ? '<span style="color:var(--text-dim);font-size:0.75rem;">View only</span>' : `
            <button class="btn-text edit-btn" data-id="${r.readingId || r.id}" style="color:var(--solar);" aria-label="Edit reading for ${startFmt}">Edit</button>
            <button class="btn-text delete-btn" data-id="${r.readingId || r.id}" style="color:var(--deficit);" aria-label="Delete reading for ${startFmt}">Delete</button>
          `}
        </td>
      </tr>
    `;
  }).join('');

  // Row Action Event Listeners
  if (!isReadOnly) {
    tbody.querySelectorAll('.edit-btn').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const reading = records.find(r => String(r.readingId || r.id) === String(id));
        if (reading) openEditModal(reading);
      });
    });

    tbody.querySelectorAll('.delete-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const reading = records.find(r => String(r.readingId || r.id) === String(id));
        if (!reading) return;
        if (window.confirm('Are you sure you want to delete this reading?')) {
          await deleteReading(reading);
        }
      });
    });
  }
}

// Building Change Event Handler
async function onBuildingChange(newBuildingId) {
  selectedBuildingId = String(newBuildingId);
  adapter.setSelectedBuildingId(selectedBuildingId);
  editingReading = null; // Clear any dangling edit state across building switch

  const selectedBuilding = apiBuildings.find(b => String(b.buildingId) === selectedBuildingId);
  if (selectedBuilding) {
    currentRole = selectedBuilding.role || 'VIEWER';
    buildingTimezone = selectedBuilding.timezone || 'UTC';
    document.getElementById('header-building-name').textContent = selectedBuilding.name;
    document.getElementById('sidebar-role-badge').textContent = currentRole;
    document.getElementById('sidebar-role-badge').className = `role-badge ${currentRole.toLowerCase()}`;
    document.getElementById('user-role-tag').textContent = currentRole;
    document.getElementById('building-tz').textContent = buildingTimezone;
  }

  currentGoals = adapter.local.getGoals(selectedBuildingId);
  document.getElementById('input-goal-coverage').value = currentGoals.targetCoveragePct;
  document.getElementById('input-goal-surplus').value = currentGoals.targetSurplusKwh;

  // Fetch full interval readings for heatmaps & analytics
  try {
    const all = await adapter.readings(selectedBuildingId, { pageSize: 10000 });
    allIntervalReadings = all.data || [];
  } catch {
    allIntervalReadings = [];
  }

  tableState.page = 1;
  await Promise.all([refreshAnalytics(), refreshTable(), refreshBuildingComparison()]);
  showToast(`Switched active building to ${selectedBuilding?.name || 'Building'}`, 'info');
}

// Reading Create / Update / Delete Handlers
function openEditModal(reading = null) {
  editingReading = reading;
  const modal = document.getElementById('modal-reading');
  const title = document.getElementById('modal-reading-title');
  const submitBtn = document.getElementById('btn-submit-reading');
  const errorEl = document.getElementById('reading-form-error');

  errorEl.hidden = true;
  document.getElementById('modal-building-tz').textContent = buildingTimezone;

  if (reading) {
    title.textContent = 'Edit reading';
    submitBtn.textContent = 'Update reading';
    document.getElementById('reading-start').value = String(reading.periodStart).slice(0, 16);
    document.getElementById('reading-end').value = String(reading.periodEnd).slice(0, 16);
    document.getElementById('reading-gen').value = reading.generatedKwh;
    document.getElementById('reading-con').value = reading.consumedKwh;
    document.getElementById('reading-grid').value = reading.gridImportKwh ?? '';
    document.getElementById('reading-bat-chg').value = reading.batteryChargeKwh ?? '';
    document.getElementById('reading-bat-dis').value = reading.batteryDischargeKwh ?? '';
  } else {
    title.textContent = 'Add reading';
    submitBtn.textContent = 'Save reading';
    document.getElementById('form-reading').reset();
    const now = new Date();
    const oneHrAgo = new Date(now.getTime() - 3600000);
    document.getElementById('reading-start').value = oneHrAgo.toISOString().slice(0, 16);
    document.getElementById('reading-end').value = now.toISOString().slice(0, 16);
  }

  modal.classList.add('open');
}

function closeReadingModal() {
  document.getElementById('modal-reading').classList.remove('open');
  editingReading = null;
}

async function handleReadingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const start = form.elements.periodStart.value;
  const end = form.elements.periodEnd.value;
  const errorEl = document.getElementById('reading-form-error');
  const submitBtn = document.getElementById('btn-submit-reading');

  if (!start || !end || end <= start) {
    errorEl.textContent = 'The period end time must be strictly after the start time.';
    errorEl.hidden = false;
    return;
  }

  const payload = {
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    generatedKwh: Number(form.elements.generatedKwh.value),
    consumedKwh: Number(form.elements.consumedKwh.value),
    gridImportKwh: form.elements.gridImportKwh.value ? Number(form.elements.gridImportKwh.value) : null,
    batteryChargeKwh: form.elements.batteryChargeKwh.value ? Number(form.elements.batteryChargeKwh.value) : null,
    batteryDischargeKwh: form.elements.batteryDischargeKwh.value ? Number(form.elements.batteryDischargeKwh.value) : null,
    source: 'MANUAL'
  };

  submitBtn.disabled = true;
  try {
    if (appMode === 'api') {
      if (editingReading) {
        await adapter.updateReading(selectedBuildingId, editingReading.readingId || editingReading.id, payload);
        showToast('Reading updated', 'success');
      } else {
        await adapter.createReading(selectedBuildingId, payload);
        showToast('Reading saved', 'success');
      }
      const all = await adapter.readings(selectedBuildingId, { pageSize: 10000 });
      allIntervalReadings = all.data || [];
    } else {
      if (editingReading) {
        Object.assign(editingReading, payload);
        showToast('Reading updated', 'success');
      } else {
        payload.id = `local-${Date.now()}`;
        previewState.readings.push(payload);
        showToast('Reading saved', 'success');
      }
      adapter.local.save(previewState);
    }

    closeReadingModal();
    await Promise.all([refreshAnalytics(), refreshTable()]);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
}

async function deleteReading(reading) {
  try {
    if (appMode === 'api') {
      await adapter.deleteReading(selectedBuildingId, reading.readingId || reading.id);
      const all = await adapter.readings(selectedBuildingId, { pageSize: 10000 });
      allIntervalReadings = all.data || [];
    } else {
      previewState.readings = previewState.readings.filter(r => (r.readingId || r.id) !== (reading.readingId || reading.id));
      adapter.local.save(previewState);
    }
    showToast('Reading deleted', 'success');
    await Promise.all([refreshAnalytics(), refreshTable()]);
  } catch (err) {
    showToast(`Failed to delete reading: ${err.message}`, 'error');
  }
}

// Building Creation
function openBuildingModal() {
  document.getElementById('modal-building').classList.add('open');
}

function closeBuildingModal() {
  document.getElementById('modal-building').classList.remove('open');
}

async function handleBuildingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.elements.name.value.trim();
  const address = form.elements.address.value.trim() || null;
  const timezone = form.elements.timezone.value;
  const errorEl = document.getElementById('building-form-error');

  try {
    if (appMode === 'api') {
      const created = await adapter.createBuilding({ name, address, timezone });
      apiBuildings = await adapter.buildings();
      populateBuildingSelect();
      await onBuildingChange(created.buildingId);
      showToast('Building created', 'success');
    } else {
      previewState.buildingName = name;
      adapter.local.save(previewState);
      document.getElementById('header-building-name').textContent = name;
      showToast('Building updated', 'success');
    }
    closeBuildingModal();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

function populateBuildingSelect() {
  const select = document.getElementById('building-select');
  select.innerHTML = '';

  if (appMode === 'api') {
    apiBuildings.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.buildingId;
      opt.textContent = `${b.name} (${b.role})`;
      opt.selected = String(b.buildingId) === String(selectedBuildingId);
      select.appendChild(opt);
    });
    select.disabled = apiBuildings.length < 2;
  } else {
    const opt = document.createElement('option');
    opt.value = 'local';
    opt.textContent = previewState.buildingName;
    select.appendChild(opt);
    select.disabled = true;
  }
}

// CSV Export & Import Handlers
function openExportModal() {
  document.getElementById('modal-export').classList.add('open');
}

function closeExportModal() {
  document.getElementById('modal-export').classList.remove('open');
}

async function handleExportDownload() {
  const from = document.getElementById('export-from').value;
  const to = document.getElementById('export-to').value;
  const cols = [
    'periodStart', 'periodEnd', 'generatedKwh', 'consumedKwh',
    document.getElementById('col-grid').checked ? 'gridImportKwh' : null,
    document.getElementById('col-batchg').checked ? 'batteryChargeKwh' : null,
    document.getElementById('col-batdis').checked ? 'batteryDischargeKwh' : null,
    document.getElementById('col-src').checked ? 'source' : null,
  ].filter(Boolean);

  try {
    if (appMode === 'api') {
      const blob = await adapter.exportCsv(selectedBuildingId, {
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        columns: cols.join(',')
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drift-building-${selectedBuildingId}-readings.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      // Local client CSV creation
      const rows = previewState.readings || [];
      const header = cols.join(',');
      const csvLines = [header];
      rows.forEach(r => {
        const line = cols.map(c => r[c] ?? '').join(',');
        csvLines.push(line);
      });
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'drift-preview-readings.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    showToast('CSV downloaded', 'success');
    closeExportModal();
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
}

function openImportModal() {
  document.getElementById('modal-import').classList.add('open');
}

function closeImportModal() {
  document.getElementById('modal-import').classList.remove('open');
}

// Initial Setup
async function initApp() {
  initTheme();
  setupMobileDrawer();
  setupModeSwitcher();
  setupGranularityControl();

  // What-If Sliders
  document.getElementById('slider-solar-increase')?.addEventListener('input', updateWhatIfPlanner);
  document.getElementById('slider-battery-capacity')?.addEventListener('input', updateWhatIfPlanner);

  // Modals & Triggers
  document.getElementById('btn-add-reading-primary')?.addEventListener('click', () => openEditModal());
  document.getElementById('btn-add-reading-table')?.addEventListener('click', () => openEditModal());
  document.getElementById('btn-close-reading-modal')?.addEventListener('click', closeReadingModal);
  document.getElementById('btn-cancel-reading')?.addEventListener('click', closeReadingModal);
  document.getElementById('form-reading')?.addEventListener('submit', handleReadingSubmit);

  document.getElementById('btn-add-building')?.addEventListener('click', openBuildingModal);
  document.getElementById('btn-close-building-modal')?.addEventListener('click', closeBuildingModal);
  document.getElementById('btn-cancel-building')?.addEventListener('click', closeBuildingModal);
  document.getElementById('form-building')?.addEventListener('submit', handleBuildingSubmit);

  document.getElementById('building-select')?.addEventListener('change', (e) => onBuildingChange(e.target.value));

  document.getElementById('sidebar-export-btn')?.addEventListener('click', openExportModal);
  document.getElementById('btn-export-table')?.addEventListener('click', openExportModal);
  document.getElementById('btn-close-export-modal')?.addEventListener('click', closeExportModal);
  document.getElementById('btn-cancel-export')?.addEventListener('click', closeExportModal);
  document.getElementById('btn-confirm-export')?.addEventListener('click', handleExportDownload);

  document.getElementById('sidebar-import-btn')?.addEventListener('click', openImportModal);
  document.getElementById('btn-import-header')?.addEventListener('click', openImportModal);
  document.getElementById('btn-close-import-modal')?.addEventListener('click', closeImportModal);
  document.getElementById('btn-cancel-import')?.addEventListener('click', closeImportModal);

  // CSV file input listener
  const csvInput = document.getElementById('input-csv-file');
  const confirmImportBtn = document.getElementById('btn-confirm-import');
  const importFeedback = document.getElementById('import-feedback');

  csvInput?.addEventListener('change', () => {
    const file = csvInput.files?.[0];
    if (file) {
      confirmImportBtn.disabled = false;
      importFeedback.style.display = 'block';
      importFeedback.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    } else {
      confirmImportBtn.disabled = true;
      importFeedback.style.display = 'none';
    }
  });

  confirmImportBtn?.addEventListener('click', async () => {
    const file = csvInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (appMode === 'api') {
        const res = await adapter.importCsv(selectedBuildingId, text);
        showToast(`Imported ${res.data?.imported || 'readings'} readings`, 'success');
        const all = await adapter.readings(selectedBuildingId, { pageSize: 10000 });
        allIntervalReadings = all.data || [];
      } else {
        // Parse CSV locally for preview mode
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const importedRows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.length >= 4) {
            importedRows.push({
              id: `import-${Date.now()}-${i}`,
              periodStart: cols[0],
              periodEnd: cols[1],
              generatedKwh: Number(cols[2]) || 0,
              consumedKwh: Number(cols[3]) || 0,
              gridImportKwh: cols[4] ? Number(cols[4]) : null,
              source: 'IMPORT'
            });
          }
        }
        previewState.readings = [...(previewState.readings || []), ...importedRows];
        adapter.local.save(previewState);
        showToast(`Imported ${importedRows.length} readings`, 'success');
      }
      closeImportModal();
      await Promise.all([refreshAnalytics(), refreshTable()]);
    } catch (err) {
      importFeedback.style.display = 'block';
      importFeedback.style.color = 'var(--deficit)';
      importFeedback.textContent = `Import error: ${err.message}`;
    }
  });

  // Demo Data Loader
  document.getElementById('btn-load-demo')?.addEventListener('click', async () => {
    const demo = generateRealisticDemoData();
    previewState = demo;
    adapter.local.save(previewState);
    document.getElementById('header-building-name').textContent = demo.buildingName;
    populateBuildingSelect();
    await Promise.all([refreshAnalytics(), refreshTable()]);
    showToast('Demo data loaded (weather-varied 7-day profile)', 'success');
  });

  // Table Controls (Search, Sort, Filters, Pagination)
  document.getElementById('input-table-search')?.addEventListener('input', (e) => {
    tableState.search = e.target.value.trim();
    tableState.page = 1;
    refreshTable();
  });

  document.getElementById('btn-apply-filter')?.addEventListener('click', () => {
    tableState.from = document.getElementById('filter-date-from').value;
    tableState.to = document.getElementById('filter-date-to').value;
    tableState.page = 1;
    refreshTable();
  });

  document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    tableState.from = '';
    tableState.to = '';
    tableState.search = '';
    document.getElementById('input-table-search').value = '';
    tableState.page = 1;
    refreshTable();
  });

  document.getElementById('page-prev')?.addEventListener('click', () => {
    if (tableState.page > 1) {
      tableState.page--;
      refreshTable();
    }
  });

  document.getElementById('page-next')?.addEventListener('click', () => {
    if (tableState.page < tableState.totalPages) {
      tableState.page++;
      refreshTable();
    }
  });

  // Table Column Sort Headers
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (tableState.sortBy === field) {
        tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tableState.sortBy = field;
        tableState.sortDir = 'asc';
      }
      refreshTable();
    });
  });

  // Tariff Slabs & Flat Toggle
  renderSlabTable('slab-tbody', tariffSlabs, (updatedSlabs) => {
    tariffSlabs = updatedSlabs;
    adapter.local.saveSlabs(tariffSlabs);
    refreshAnalytics();
  });

  document.getElementById('btn-tariff-slab')?.addEventListener('click', () => {
    tariffMode = 'slab';
    document.getElementById('btn-tariff-slab').classList.add('active');
    document.getElementById('btn-tariff-flat').classList.remove('active');
    document.getElementById('slab-container').style.display = 'flex';
    document.getElementById('flat-container').style.display = 'none';
    refreshAnalytics();
  });

  document.getElementById('btn-tariff-flat')?.addEventListener('click', () => {
    tariffMode = 'flat';
    document.getElementById('btn-tariff-flat').classList.add('active');
    document.getElementById('btn-tariff-slab').classList.remove('active');
    document.getElementById('slab-container').style.display = 'none';
    document.getElementById('flat-container').style.display = 'flex';
    refreshAnalytics();
  });

  document.getElementById('input-flat-rate')?.addEventListener('change', (e) => {
    flatRate = Number(e.target.value) || 8.25;
    refreshAnalytics();
  });

  // Emission Factor & Goals Save
  document.getElementById('input-emission-factor')?.addEventListener('change', (e) => {
    emissionFactor = Number(e.target.value) || 0.716;
    refreshAnalytics();
  });

  document.getElementById('btn-save-goals')?.addEventListener('click', () => {
    const cov = Number(document.getElementById('input-goal-coverage').value) || 80;
    const sur = Number(document.getElementById('input-goal-surplus').value) || 150;
    currentGoals = { targetCoveragePct: cov, targetSurplusKwh: sur };
    adapter.local.saveGoals(selectedBuildingId || 'default', currentGoals);
    document.getElementById('goal-target-cov-num').textContent = cov;
    document.getElementById('goal-target-surplus-num').textContent = sur;
    refreshAnalytics();
    showToast('Goals updated', 'success');
  });

  // Printable Weekly Report
  document.getElementById('sidebar-report-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Dismiss Telemetry Gap Alert
  document.getElementById('btn-dismiss-gap')?.addEventListener('click', () => {
    document.getElementById('gap-alert-bar').hidden = true;
  });
  document.getElementById('btn-view-gaps')?.addEventListener('click', () => {
    document.querySelector('#readings-section').scrollIntoView({ behavior: 'smooth' });
    showToast('Showing interval telemetry readings', 'info');
  });

  // Command Palette Initialization
  initCommandPalette({
    navigate: (sectionId) => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    },
    toggleTheme: () => document.getElementById('btn-theme-toggle').click(),
    toggleMode: () => {
      if (appMode === 'api') window.location.href = window.location.pathname;
      else window.location.href = window.location.pathname + '?mode=api&userId=1';
    },
    loadDemoData: () => document.getElementById('btn-load-demo')?.click(),
    openExportModal,
    openImportModal,
    printReport: () => window.print(),
    openAddReading: () => openEditModal(),
    getBuildings: () => apiBuildings,
    selectBuilding: (id) => onBuildingChange(id)
  });

  // API Mode initialization
  if (appMode === 'api') {
    try {
      apiBuildings = await adapter.buildings();
      if (apiBuildings.length > 0) {
        const preferred = apiBuildings.find(b => String(b.buildingId) === String(selectedBuildingId)) || apiBuildings[0];
        selectedBuildingId = String(preferred.buildingId);
        adapter.setSelectedBuildingId(selectedBuildingId);
        currentRole = preferred.role || 'VIEWER';
        buildingTimezone = preferred.timezone || 'UTC';
        document.getElementById('header-building-name').textContent = preferred.name;
        document.getElementById('sidebar-role-badge').textContent = currentRole;
        document.getElementById('sidebar-role-badge').className = `role-badge ${currentRole.toLowerCase()}`;
        document.getElementById('user-role-tag').textContent = currentRole;
        document.getElementById('building-tz').textContent = buildingTimezone;

        const all = await adapter.readings(selectedBuildingId, { pageSize: 10000 });
        allIntervalReadings = all.data || [];
      } else {
        document.getElementById('header-building-name').textContent = 'No buildings found';
      }
    } catch (err) {
      console.error('Failed to load initial API data:', err);
      const errBanner = document.getElementById('banner-error');
      if (errBanner) {
        errBanner.hidden = false;
        document.getElementById('banner-error-text').textContent = `Could not connect to API: ${err.message}. Ensure backend is running.`;
      }
    }
  } else {
    document.getElementById('header-building-name').textContent = previewState.buildingName;
  }

  populateBuildingSelect();
  await Promise.all([refreshAnalytics(), refreshTable(), refreshBuildingComparison()]);
  updateWhatIfPlanner();
}

// Kick off initialization on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initApp();
}
