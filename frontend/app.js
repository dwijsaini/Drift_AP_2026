import { adapter } from './data-adapter.js';

const today = new Date();
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const dateInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const addDays = (value, days) => {
  const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const dateTimeInput = (date) => dateInput(date) + 'T' +
  String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
const normalizeLocalState = (saved) => {
  const value = saved && typeof saved === 'object' ? saved : {};
  const readings = Array.isArray(value.readings) ? value.readings.map((row) => ({
    ...row,
    periodStart: /^\d{4}-\d{2}-\d{2}$/.test(row.periodStart || '')
      ? row.periodStart + 'T00:00' : row.periodStart,
    periodEnd: /^\d{4}-\d{2}-\d{2}$/.test(row.periodEnd || '')
      ? addDays(row.periodEnd, 1) + 'T00:00' : row.periodEnd,
  })) : [];
  return { buildingName: value.buildingName || 'My home', readings };
};

let state = normalizeLocalState(adapter.local.load());
let apiBuildings = [];
let selectedBuildingId = null;
let currentRole = 'OWNER';
let buildingTimezone = localTimezone;
let summaryCache = {};
let editing = null;
let readingPage = 1;
let readingHasMore = false;
const RATE_KEY = 'drift.electricity-rate-inr';
const THEME_KEY = 'drift.theme';
const themePreference = localStorage.getItem(THEME_KEY)
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = themePreference;
const themeButton = document.querySelector('#theme-toggle');
themeButton.textContent = themePreference === 'dark' ? 'Light theme' : 'Dark theme';
themeButton.setAttribute('aria-label', 'Switch to ' + (themePreference === 'dark' ? 'light' : 'dark') + ' theme');
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  themeButton.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
  themeButton.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
});
const rateInput = document.querySelector('#electricity-rate');
const advancedStatus = document.querySelector('#advanced-status');
rateInput.value = localStorage.getItem(RATE_KEY) || '';
document.querySelector('#emission-factor').value = localStorage.getItem('drift.emission-factor') || '0.71';
document.querySelector('#emission-source').value = localStorage.getItem('drift.emission-source') || 'Example assumption; replace with a published local grid factor';

const form = document.querySelector('#reading-form');
const startInput = form.elements.periodStart;
const endInput = form.elements.periodEnd;
const appError = document.querySelector('#app-error');
startInput.value = dateTimeInput(new Date(today.getTime() - 3_600_000));
endInput.value = dateTimeInput(today);

function showError(message) {
  appError.textContent = message;
  appError.hidden = !message;
}

function localDateTimeIso(value, timezone) {
  const [date, time = '00:00'] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let guess = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]));
    const representedUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    guess += desiredUtc - representedUtc;
  }
  return new Date(guess).toISOString();
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function dateTimeInTimezone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day + 'T' + values.hour + ':' + values.minute;
}

function mapApiReading(row, timezone) {
  return {
    id: String(row.readingId),
    periodStart: dateTimeInTimezone(row.periodStart, timezone),
    periodEnd: dateTimeInTimezone(row.periodEnd, timezone),
    generatedKwh: numeric(row.generatedKwh),
    consumedKwh: numeric(row.consumedKwh),
    gridImportKwh: row.gridImportKwh == null ? null : numeric(row.gridImportKwh),
    batteryChargeKwh: row.batteryChargeKwh == null ? null : numeric(row.batteryChargeKwh),
    batteryDischargeKwh: row.batteryDischargeKwh == null ? null : numeric(row.batteryDischargeKwh),
  };
}

function mapApiSummary(row, granularity) {
  const start = String(row.periodStart).slice(0, 10);
  const endExclusive = String(row.periodEnd).slice(0, 10);
  return {
    id: granularity + ':' + start,
    periodStart: start,
    periodEnd: addDays(endExclusive, -1),
    generatedKwh: numeric(row.generatedKwh),
    consumedKwh: numeric(row.consumedKwh),
    gridImportKwh: row.gridImportKwh == null ? null : numeric(row.gridImportKwh),
    expectedReadingCount: numeric(row.expectedReadingCount),
    missingPeriodCount: numeric(row.missingPeriodCount),
    hasGap: Boolean(row.hasGap),
    estimatedGridCostInr: row.estimatedGridCostInr == null ? null : numeric(row.estimatedGridCostInr),
  };
}

function selectedRate() {
  const value = rateInput.value.trim();
  return value === '' ? undefined : Number(value);
}

function toApiReading(reading) {
  const optionalNumber = (name) => {
    const value = reading[name];
    return value === '' || value == null ? null : Number(value);
  };
  return {
    periodStart: localDateTimeIso(reading.periodStart, buildingTimezone),
    periodEnd: localDateTimeIso(reading.periodEnd, buildingTimezone),
    generatedKwh: Number(reading.generatedKwh),
    consumedKwh: Number(reading.consumedKwh),
    gridImportKwh: optionalNumber('gridImportKwh'),
    batteryChargeKwh: optionalNumber('batteryChargeKwh'),
    batteryDischargeKwh: optionalNumber('batteryDischargeKwh'),
    source: 'MANUAL',
  };
}

function coverage(generated, consumed) {
  return consumed === 0 ? null : Math.min(100, generated / consumed * 100);
}

function displayNumber(value, digits = 1) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function aggregateReadings(rows, granularity) {
  if (granularity === 'all') {
    return rows.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  }
  const groups = new Map();
  for (const row of rows) {
    const periodDate = row.periodStart.slice(0, 10);
    const date = new Date(periodDate + 'T12:00:00Z');
    let key;
    if (granularity === 'daily') key = periodDate;
    else if (granularity === 'monthly') {
      key = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
    } else {
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    }
    const group = groups.get(key) || {
      ...row, id: key, periodStart: key, periodEnd: row.periodEnd,
      generatedKwh: 0, consumedKwh: 0, gridImportKwh: null,
    };
    group.generatedKwh += numeric(row.generatedKwh);
    group.consumedKwh += numeric(row.consumedKwh);
    if (row.gridImportKwh != null) {
      group.gridImportKwh = numeric(group.gridImportKwh) + numeric(row.gridImportKwh);
    }
    if (row.periodEnd > group.periodEnd) group.periodEnd = row.periodEnd;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

async function refreshApiData(preferredBuildingId = selectedBuildingId) {
  apiBuildings = await adapter.buildings();
  const preferred = preferredBuildingId || adapter.selectedBuildingId();
  const selected = apiBuildings.find((building) => String(building.buildingId) === String(preferred))
    || apiBuildings[0]
    || null;

  summaryCache = {};
  if (!selected) {
    selectedBuildingId = null;
    state = { buildingName: 'No buildings yet', readings: [] };
    currentRole = 'VIEWER';
    return;
  }

  selectedBuildingId = String(selected.buildingId);
  adapter.setSelectedBuildingId(selectedBuildingId);
  currentRole = selected.role || 'VIEWER';
  buildingTimezone = selected.timezone || 'UTC';
  const sortParts = document.querySelector('#reading-sort').value.split(':');
  const fromDay = document.querySelector('#reading-from').value;
  const toDay = document.querySelector('#reading-to').value;
  const pageResult = await adapter.readingPage(selectedBuildingId, {
    page: readingPage, pageSize: 50, search: document.querySelector('#reading-search').value,
    from: fromDay ? fromDay + 'T00:00:00Z' : undefined,
    to: toDay ? new Date(new Date(toDay + 'T00:00:00Z').getTime() + 86400000).toISOString() : undefined,
    sortBy: sortParts[0], sortOrder: sortParts[1],
  });
  const rows = pageResult.data;
  readingHasMore = Boolean(pageResult.meta.hasMore);
  state = {
    buildingName: selected.name || 'Building',
    readings: rows.slice(0, 50).map((row) => mapApiReading(row, buildingTimezone)),
  };

  if (!state.readings.length) return;
  const bounds = {
    search: document.querySelector('#reading-search').value,
    from: fromDay ? fromDay + 'T00:00:00Z' : undefined,
    to: toDay ? new Date(new Date(toDay + 'T00:00:00Z').getTime() + 86400000).toISOString() : undefined,
    pageSize: 1,
  };
  const [oldestPage, newestPage] = await Promise.all([
    adapter.readings(selectedBuildingId, { ...bounds, page: 1, sortBy: 'periodStart', sortOrder: 'asc' }),
    adapter.readings(selectedBuildingId, { ...bounds, page: 1, sortBy: 'periodStart', sortOrder: 'desc' }),
  ]);
  const first = oldestPage[0] ? dateTimeInTimezone(oldestPage[0].periodStart, buildingTimezone) : state.readings[0].periodStart;
  const last = newestPage[0] ? dateTimeInTimezone(newestPage[0].periodEnd, buildingTimezone) : state.readings[0].periodEnd;
  const from = localDateTimeIso(first, buildingTimezone);
  const to = localDateTimeIso(last, buildingTimezone);
  const granularities = ['daily', 'weekly', 'monthly'];
  const results = await Promise.allSettled(granularities.map((unit) =>
    adapter.summary(selectedBuildingId, unit, from, to, selectedRate())));
  granularities.forEach((unit, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      summaryCache[unit] = result.value.map((row) => mapApiSummary(row, unit));
    } else {
      summaryCache[unit] = aggregateReadings([...state.readings], unit);
      showError('The summary service is unavailable; showing calculations from the loaded readings.');
    }
  });
}

function drawChart(readings) {
  const canvas = document.querySelector('#energy-chart');
  const width = canvas.clientWidth;
  const height = 157;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const visible = readings.slice(-8);
  const max = Math.max(1, ...visible.flatMap((row) => [row.generatedKwh, row.consumedKwh, Math.abs(row.generatedKwh - row.consumedKwh)]));
  const left = 15;
  const right = width - 12;
  const top = 10;
  const bottom = height - 9;
  context.strokeStyle = '#edf1ec';
  context.lineWidth = 1;
  for (let line = 0; line < 4; line += 1) {
    const y = top + ((bottom - top) / 3) * line;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  }
  const groupWidth = (right - left) / visible.length;
  const barWidth = Math.min(12, groupWidth * 0.25);
  visible.forEach((reading, index) => {
    const center = left + groupWidth * (index + 0.5);
    const generatedHeight = (reading.generatedKwh / max) * (bottom - top);
    const consumedHeight = (reading.consumedKwh / max) * (bottom - top);
    context.fillStyle = '#91b741';
    context.beginPath();
    context.roundRect(center - barWidth - 1, bottom - generatedHeight, barWidth, generatedHeight, 4);
    context.fill();
    context.fillStyle = '#f0a17c';
    context.beginPath();
    context.roundRect(center + 1, bottom - consumedHeight, barWidth, consumedHeight, 4);
    context.fill();
  });
  context.strokeStyle = '#58a6ff'; context.lineWidth = 2; context.beginPath();
  visible.forEach((reading, index) => {
    const center = left + groupWidth * (index + 0.5);
    const balance = reading.generatedKwh - reading.consumedKwh;
    const y = bottom - ((balance + max) / (2 * max)) * (bottom - top);
    if (index === 0) context.moveTo(center, y); else context.lineTo(center, y);
  });
  context.stroke();
  const labels = document.querySelector('#chart-labels');
  labels.replaceChildren(...visible.map((reading) => {
    const label = document.createElement('span');
    label.textContent = new Date(reading.periodEnd.slice(0, 10) + 'T12:00:00Z')
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return label;
  }));
}

function renderPeakHeatmap(rows) {
  const target = document.querySelector('#peak-heatmap');
  const values = new Map();
  rows.forEach((row) => {
    const date = new Date(row.periodStart);
    const key = date.getDay() + ':' + date.getHours();
    const item = values.get(key) || { balance: 0, count: 0 };
    item.balance += numeric(row.generatedKwh) - numeric(row.consumedKwh);
    item.count += 1;
    values.set(key, item);
  });
  const cells = [];
  for (let day = 0; day < 7; day += 1) for (let hour = 0; hour < 24; hour += 1) {
    const value = values.get(day + ':' + hour);
    const cell = document.createElement('span');
    cell.className = 'heat-cell' + (value ? (value.balance >= 0 ? ' surplus' : ' deficit') : ' missing');
    cell.setAttribute('role', 'gridcell');
    cell.title = value ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day] + ' ' + hour + ':00 · ' + displayNumber(value.balance) + ' kWh balance' : 'No reading';
    cell.setAttribute('aria-label', cell.title);
    if (value) cell.style.setProperty('--intensity', String(Math.min(1, Math.abs(value.balance) / 10)));
    cells.push(cell);
  }
  target.replaceChildren(...cells);
}

function renderInsights(rows, generated, consumed) {
  const list = document.querySelector('#insights-list');
  const points = rows.map((row) => ({ row, delta: numeric(row.generatedKwh) - numeric(row.consumedKwh) }));
  const messages = [];
  if (points.length) {
    const peak = [...points].sort((a, b) => numeric(b.row.generatedKwh) - numeric(a.row.generatedKwh))[0];
    const deficit = [...points].sort((a, b) => a.delta - b.delta)[0];
    messages.push('Best solar period generated ' + displayNumber(peak.row.generatedKwh) + ' kWh.');
    messages.push('Largest recorded deficit: ' + displayNumber(Math.max(0, -deficit.delta)) + ' kWh.');
    messages.push('Overall solar coverage is ' + displayNumber(coverage(generated, consumed) || 0) + '%.');
    const gaps = rows.filter((row) => row.missingPeriodCount > 0).length;
    if (gaps) messages.push('Some periods have missing readings; missed generation cannot be measured from available data.');
  }
  list.replaceChildren(...(messages.length ? messages : ['Add readings to see insights.']).map((message) => {
    const item = document.createElement('li'); item.textContent = message; return item;
  }));
  const factor = Math.max(0, Number(document.querySelector('#emission-factor').value) || 0);
  const source = document.querySelector('#emission-source').value.trim() || 'source not supplied';
  document.querySelector('#co2-estimate').textContent = 'CO₂ avoided estimate: ' + displayNumber(generated * factor, 1) + ' kg (factor ' + displayNumber(factor, 2) + ' kg/kWh; source: ' + source + ').';
}

function render() {
  const apiMode = adapter.mode === 'api';
  document.querySelector('#demo-label').hidden = !state.buildingName.startsWith('Generated demo data');
  const buildingSelect = document.querySelector('#building-select');
  buildingSelect.replaceChildren();
  if (apiMode) {
    apiBuildings.forEach((building) => {
      const option = document.createElement('option');
      option.value = String(building.buildingId);
      option.textContent = building.name;
      option.selected = option.value === selectedBuildingId;
      buildingSelect.append(option);
    });
    buildingSelect.disabled = apiBuildings.length < 2;
  } else {
    const option = document.createElement('option');
    option.value = 'local';
    option.textContent = state.buildingName;
    buildingSelect.append(option);
    buildingSelect.disabled = true;
  }

  document.querySelector('#crumb-building').textContent = state.buildingName || 'My home';
  const status = document.querySelector('#mode-status');
  status.textContent = apiMode
    ? 'API mode · user ' + (adapter.userId || 'ID required')
    : 'Saved on this device';
  document.querySelector('#manage-building').textContent = apiMode ? 'Add building' : 'Manage building';
  document.querySelector('#clear-data').hidden = apiMode;
  document.querySelector('#csv-controls').hidden = false;
  document.querySelector('#compare-buildings').hidden = !apiMode;
  document.querySelector('#import-csv').disabled = apiMode && (!selectedBuildingId || currentRole === 'VIEWER');
  document.querySelector('#export-csv').disabled = apiMode
    ? !selectedBuildingId : state.readings.length === 0;
  document.querySelector('#compare-buildings').disabled = !apiMode || !state.readings.length;
  document.querySelector('#scenario-increase').disabled = false;
  document.querySelector('footer span:last-child').textContent = apiMode
    ? 'Connected to the Drift API · readings stored in PostgreSQL'
    : 'Browser preview · data stays on this device';

  const canEdit = !apiMode || (selectedBuildingId && currentRole !== 'VIEWER');
  form.querySelectorAll('input, button').forEach((control) => { control.disabled = !canEdit; });
  document.querySelector('#manage-building').disabled = false;

  const range = document.querySelector('#range-select').value;
  const readings = apiMode && summaryCache[range]
    ? summaryCache[range]
    : aggregateReadings([...state.readings], range);
  const generated = readings.reduce((sum, row) => sum + numeric(row.generatedKwh), 0);
  const consumed = readings.reduce((sum, row) => sum + numeric(row.consumedKwh), 0);
  const balance = generated - consumed;
  const percent = coverage(generated, consumed);
  document.querySelector('#total-generated').textContent = displayNumber(generated);
  document.querySelector('#total-consumed').textContent = displayNumber(consumed);
  const balanceCard = document.querySelector('.balance-card');
  balanceCard.classList.toggle('negative', balance < 0);
  document.querySelector('#total-balance').textContent =
    (balance > 0 ? '+' : '') + displayNumber(balance);
  document.querySelector('#balance-note').textContent =
    balance < 0 ? 'Use exceeded solar generation' : 'Generation minus consumption';
  document.querySelector('#solar-coverage').textContent =
    percent === null ? '—' : displayNumber(percent, 0);
  document.querySelector('#coverage-unit').textContent = percent === null ? '' : '%';
  const scaleMaximum = Math.max(1, generated, consumed);
  document.querySelector('#generated-bar').value = generated / scaleMaximum * 100;
  document.querySelector('#consumed-bar').value = consumed / scaleMaximum * 100;
  document.querySelector('#balance-bar').value = Math.min(100, Math.abs(balance) / scaleMaximum * 100);
  document.querySelector('#coverage-bar').value = percent || 0;
  document.querySelector('#coverage-dial-value').style.strokeDashoffset = String(251.3 * (1 - Math.min(100, percent || 0) / 100));
  renderPeakHeatmap(state.readings);
  renderInsights(readings, generated, consumed);

  const body = document.querySelector('#readings-body');
  let sorted = [...state.readings];
  if (!apiMode) {
    const query = document.querySelector('#reading-search').value.trim().toLowerCase();
    const fromDay = document.querySelector('#reading-from').value;
    const toDay = document.querySelector('#reading-to').value;
    sorted = sorted.filter((row) => (!query || JSON.stringify(row).toLowerCase().includes(query))
      && (!fromDay || row.periodStart.slice(0, 10) >= fromDay)
      && (!toDay || row.periodStart.slice(0, 10) <= toDay));
    const [field, direction] = document.querySelector('#reading-sort').value.split(':');
    sorted.sort((a, b) => field === 'periodStart' ? a.periodStart.localeCompare(b.periodStart) * (direction === 'desc' ? -1 : 1)
      : (numeric(a[field]) - numeric(b[field])) * (direction === 'desc' ? -1 : 1));
    readingHasMore = sorted.length > readingPage * 50;
  }
  const visibleReadings = apiMode ? sorted : sorted.slice((readingPage - 1) * 50, readingPage * 50);
  body.replaceChildren(...visibleReadings.map((reading) => {
    const gap = reading.generatedKwh - reading.consumedKwh;
    const rowCoverage = coverage(reading.generatedKwh, reading.consumedKwh);
    const row = document.createElement('tr');
    const values = [
      reading.periodStart.replace('T', ' ') + ' – ' + reading.periodEnd.replace('T', ' '),
      displayNumber(reading.generatedKwh) + ' kWh',
      displayNumber(reading.consumedKwh) + ' kWh',
      (gap > 0 ? '+' : '') + displayNumber(gap) + ' kWh',
      rowCoverage === null ? '—' : displayNumber(rowCoverage, 0) + '%',
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 3) cell.className = gap >= 0 ? 'positive' : 'negative-text';
      row.append(cell);
    });
    const coverageCell = row.children[4];
    coverageCell.innerHTML = '';
    const coveragePill = document.createElement('span');
    coveragePill.className = 'coverage-pill ' + (rowCoverage == null ? 'unknown' : rowCoverage >= 100 ? 'good' : rowCoverage >= 70 ? 'mid' : 'low');
    coveragePill.textContent = rowCoverage === null ? '—' : displayNumber(rowCoverage, 0) + '%';
    coverageCell.append(coveragePill);
    const completeness = document.createElement('td');
    const hours = Math.max(0, Math.min(24, (Date.parse(reading.periodEnd) - Date.parse(reading.periodStart)) / 3_600_000));
    completeness.innerHTML = '<span class="completeness-track"><i style="width:' + (hours / 24 * 100) + '%"></i></span> ' + displayNumber(hours, 0) + '/24';
    completeness.setAttribute('aria-label', displayNumber(hours, 0) + ' hourly slots represented out of 24');
    row.append(completeness);
    const actions = document.createElement('td');
    if (canEdit) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'text-button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => editReading(reading));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'text-button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteReading(reading));
      actions.append(editButton, deleteButton);
    } else {
      actions.textContent = 'View only';
    }
    row.append(actions);
    return row;
  }));
  document.querySelector('#table-empty').hidden = sorted.length > 0;
  document.querySelector('#reading-page-label').textContent = 'Page ' + readingPage;
  document.querySelector('#reading-prev').disabled = readingPage <= 1;
  document.querySelector('#reading-next').disabled = !readingHasMore;
  const hasReadings = readings.length > 0;
  document.querySelector('#chart-empty').hidden = hasReadings;
  document.querySelector('#chart-wrap').hidden = !hasReadings;
  if (hasReadings) drawChart(readings);

  const recent = [...readings].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).slice(-3);
  const worsening = recent.length === 3
    && recent.every((row) => row.consumedKwh > row.generatedKwh)
    && recent[1].consumedKwh - recent[1].generatedKwh > recent[0].consumedKwh - recent[0].generatedKwh
    && recent[2].consumedKwh - recent[2].generatedKwh > recent[1].consumedKwh - recent[1].generatedKwh;
  document.querySelector('#worsening-alert').hidden = !worsening;

  const completenessRows = readings.filter((row) => Number.isFinite(row.expectedReadingCount));
  const expectedCount = completenessRows.reduce((sum, row) => sum + row.expectedReadingCount, 0);
  const missingCount = completenessRows.reduce((sum, row) => sum + row.missingPeriodCount, 0);
  const completenessAlert = document.querySelector('#completeness-alert');
  completenessAlert.hidden = !apiMode || completenessRows.length === 0 || missingCount === 0;
  document.querySelector('#completeness-message').textContent = missingCount
    + ' of ' + expectedCount + ' expected hourly readings are missing in this view.';

  const qualityIssues = [];
  const chronological = [...state.readings].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  let overlapCount = 0;
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].periodStart < chronological[index - 1].periodEnd) overlapCount += 1;
  }
  if (overlapCount) qualityIssues.push(overlapCount + ' overlapping reading period' + (overlapCount === 1 ? '' : 's'));
  const consumptions = chronological.map((row) => numeric(row.consumedKwh)).filter((value) => value > 0).sort((a, b) => a - b);
  if (consumptions.length >= 4) {
    const median = consumptions[Math.floor(consumptions.length / 2)];
    const unusualCount = chronological.filter((row) => numeric(row.consumedKwh) > median * 3).length;
    if (unusualCount) qualityIssues.push(unusualCount + ' unusually high consumption reading' + (unusualCount === 1 ? '' : 's') + ' (over 3× the median)');
  }
  if (completenessRows.length && missingCount) qualityIssues.push(missingCount + ' missing hourly reading' + (missingCount === 1 ? '' : 's'));
  const qualityAlert = document.querySelector('#quality-alert');
  qualityAlert.hidden = qualityIssues.length === 0;
  qualityAlert.textContent = qualityIssues.length
    ? 'Data quality: ' + qualityIssues.join(' · ') + '. Review the readings below.'
    : 'Data quality looks good for the loaded readings.';
  const notices = [...qualityIssues.map((issue) => 'Review: ' + issue)];
  if (worsening) notices.push('Energy gap has widened over the last three periods.');

  const goalInput = document.querySelector('#monthly-goal-input');
  const goalKey = 'drift.monthly-coverage-goal.' + (selectedBuildingId || 'preview');
  const surplusInput = document.querySelector('#monthly-surplus-input');
  const surplusKey = 'drift.monthly-surplus-goal.' + (selectedBuildingId || 'preview');
  const savedGoal = localStorage.getItem(goalKey);
  const savedSurplusGoal = localStorage.getItem(surplusKey);
  if (savedGoal && document.activeElement !== goalInput) goalInput.value = savedGoal;
  if (savedSurplusGoal && document.activeElement !== surplusInput) surplusInput.value = savedSurplusGoal;
  const goalTarget = Math.min(100, Math.max(1, Number(goalInput.value) || 80));
  const now = new Date();
  const monthPrefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthRows = state.readings.filter((row) => row.periodStart.slice(0, 7) === monthPrefix);
  const monthGenerated = monthRows.reduce((sum, row) => sum + numeric(row.generatedKwh), 0);
  const monthConsumed = monthRows.reduce((sum, row) => sum + numeric(row.consumedKwh), 0);
  const monthCoverage = monthConsumed > 0 ? monthGenerated / monthConsumed * 100 : 0;
  const surplusTarget = Math.max(0, Number(surplusInput.value) || 0);
  const monthSurplus = monthGenerated - monthConsumed;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedSurplus = monthSurplus / Math.max(1, now.getDate()) * daysInMonth;
  document.querySelector('#monthly-goal-progress').textContent = displayNumber(monthCoverage) + '%';
  document.querySelector('#monthly-goal-label').textContent = monthRows.length
    ? displayNumber(Math.min(100, monthCoverage / goalTarget * 100)) + '% of ' + goalTarget + '% target'
    : 'No readings recorded this month';
  const goalBar = document.querySelector('#monthly-goal-bar');
  goalBar.value = Math.min(100, monthCoverage / goalTarget * 100);
  goalBar.classList.toggle('goal-met', monthCoverage >= goalTarget);
  document.querySelector('#monthly-surplus-progress').textContent =
    'Surplus: ' + displayNumber(monthSurplus) + ' / ' + displayNumber(surplusTarget) + ' kWh';
  document.querySelector('#monthly-goal-projection').textContent = !monthRows.length
    ? 'Projection: waiting for readings'
    : surplusTarget === 0 || projectedSurplus >= surplusTarget
      ? 'Projection: on track'
      : 'Projection: at risk (' + displayNumber(projectedSurplus) + ' kWh)';
  if (monthCoverage >= goalTarget && monthRows.length) notices.push('Monthly solar coverage goal reached.');
  if (surplusTarget > 0 && monthSurplus >= surplusTarget) notices.push('Monthly energy surplus goal reached.');
  const deficitDays = new Set(state.readings.filter((row) => numeric(row.consumedKwh) > numeric(row.generatedKwh)).map((row) => row.periodStart.slice(0, 10)));
  if (deficitDays.size) notices.push('Consumption exceeded generation on ' + deficitDays.size + ' recorded day(s).');
  const dayCoverage = (days) => {
    const selected = state.readings.filter((row) => days.has(row.periodStart.slice(0, 10)));
    const use = selected.reduce((sum, row) => sum + numeric(row.consumedKwh), 0);
    return use ? selected.reduce((sum, row) => sum + numeric(row.generatedKwh), 0) / use * 100 : null;
  };
  const recentDays = new Set(Array.from({length:7}, (_, i) => addDays(dateInput(now), -i)));
  const previousDays = new Set(Array.from({length:7}, (_, i) => addDays(dateInput(now), -7-i)));
  const recentCoverage = dayCoverage(recentDays); const previousCoverage = dayCoverage(previousDays);
  if (recentCoverage != null && previousCoverage != null && recentCoverage < previousCoverage - 5) notices.push('Solar coverage has dropped ' + displayNumber(previousCoverage - recentCoverage) + ' points versus last week.');
  const noticeList = document.querySelector('#notification-list');
  noticeList.replaceChildren(...(notices.length ? notices : ['No new energy alerts.']).map((message) => {
    const item = document.createElement('li'); item.textContent = message; return item;
  }));
  const unread = localStorage.getItem('drift.notices-read') === JSON.stringify(notices) ? 0 : notices.length;
  document.querySelector('#notification-count').textContent = String(unread);

  const rate = selectedRate();
  const meterRows = readings.filter((row) => row.gridImportKwh != null);
  const hasGridData = meterRows.length > 0;
  const gridTotal = meterRows.reduce((sum, row) => sum + numeric(row.gridImportKwh), 0);
  const serverCostRows = meterRows.filter((row) => row.estimatedGridCostInr != null);
  const estimatedCost = serverCostRows.length
    ? serverCostRows.reduce((sum, row) => sum + numeric(row.estimatedGridCostInr), 0)
    : (rate === undefined ? null : gridTotal * rate);
  document.querySelector('#estimated-grid-cost').textContent =
    estimatedCost == null || !hasGridData ? '—' : '₹' + displayNumber(estimatedCost, 2);
  document.querySelector('#stat-grid-cost').textContent = estimatedCost == null || !hasGridData ? '—' : '₹' + displayNumber(estimatedCost, 0);
  document.querySelector('#stat-grid-import').textContent = displayNumber(gridTotal);
  const tariffTotal = gridTotal;
  let tariffCost = 0;
  document.querySelectorAll('.slab-from').forEach((input, index) => {
    const from = Number(input.value) || 0;
    const to = Number(document.querySelectorAll('.slab-to')[index].value) || Infinity;
    const rate = Math.max(0, Number(document.querySelectorAll('.slab-rate')[index].value) || 0);
    tariffCost += Math.max(0, Math.min(tariffTotal, to) - from) * rate;
  });
  document.querySelector('#tariff-estimate').textContent = document.querySelector('#tariff-mode').checked
    ? 'Example tariff estimate: ₹' + displayNumber(tariffCost, 2) + ' (recorded grid import only).'
    : 'Flat-rate estimate: ' + (estimatedCost == null ? '—' : '₹' + displayNumber(estimatedCost, 2));
  document.querySelector('#grid-cost-note').textContent = rate === undefined
    ? 'Enter your rate; only recorded grid imports are counted.'
    : !hasGridData
      ? 'No grid-import readings are recorded for this view.'
      : 'Estimate only; it is not a utility bill.';

  const increase = Number(document.querySelector('#scenario-increase').value);
  document.querySelector('#scenario-percent').textContent = increase + '%';
  const projectedGeneration = generated * (1 + increase / 100);
  const projectedBalance = projectedGeneration - consumed;
  document.querySelector('#scenario-result').textContent =
    'Projected balance: ' + (projectedBalance > 0 ? '+' : '') +
    displayNumber(projectedBalance) + ' kWh (' + displayNumber(projectedGeneration) + ' kWh generation).';
  const batteryCapacity = Number(document.querySelector('#battery-capacity').value);
  const avoided = Math.min(batteryCapacity, meterRows.reduce((sum, row) => sum + numeric(row.gridImportKwh), 0));
  document.querySelector('#battery-capacity-label').textContent = batteryCapacity + ' kWh';
  document.querySelector('#battery-result').textContent = 'Potential grid import avoided: ' + displayNumber(avoided) + ' kWh (scenario only; not saved).';
}

async function editReading(reading) {
  editing = reading;
  for (const key of [
    'periodStart', 'periodEnd', 'generatedKwh', 'consumedKwh',
    'gridImportKwh', 'batteryChargeKwh', 'batteryDischargeKwh',
  ]) {
    form.elements[key].value = reading[key] ?? '';
  }
  document.querySelector('#reading-form-title').textContent = 'Edit reading';
  document.querySelector('#reading-submit').textContent = 'Update reading →';
  document.querySelector('#cancel-edit').hidden = false;
  document.querySelector('#reading-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  editing = null;
  form.reset();
  startInput.value = dateTimeInput(new Date(Date.now() - 3_600_000));
  endInput.value = dateTimeInput(new Date());
  document.querySelector('#reading-form-title').textContent = 'Add a reading';
  document.querySelector('#reading-submit').textContent = 'Save reading →';
  document.querySelector('#cancel-edit').hidden = true;
  showError('');
}

async function deleteReading(reading) {
  if (!window.confirm('Delete this reading?')) return;
  try {
    if (adapter.mode === 'api') {
      await adapter.deleteReading(selectedBuildingId, reading.id);
      await refreshApiData();
    } else {
      state.readings = state.readings.filter((row) => row !== reading);
      adapter.local.save(state);
    }
    showError('');
    render();
  } catch (error) {
    showError(error.message);
  }
}

const buildingForm = document.querySelector('#building-form');
const buildingNameInput = document.querySelector('#building-name');

document.querySelector('#manage-building').addEventListener('click', () => {
  buildingNameInput.value = adapter.mode === 'api' ? '' : state.buildingName;
  buildingForm.hidden = !buildingForm.hidden;
  if (!buildingForm.hidden) buildingNameInput.focus();
});

document.querySelector('#cancel-building').addEventListener('click', () => {
  buildingForm.hidden = true;
  showError('');
});

buildingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = buildingNameInput.value.trim();
  if (!name) return;
  try {
    if (adapter.mode === 'api') {
      const building = await adapter.createBuilding({
        name: name.trim(), timezone: localTimezone,
      });
      await refreshApiData(String(building.buildingId));
    } else {
      state.buildingName = name.trim();
      adapter.local.save(state);
    }
    buildingForm.hidden = true;
    showError('');
    render();
  } catch (error) {
    showError(error.message);
  }
});

document.querySelector('#building-select').addEventListener('change', async (event) => {
  if (adapter.mode !== 'api') return;
  try {
    await refreshApiData(event.target.value);
    showError('');
    render();
  } catch (error) {
    showError(error.message);
  }
});

async function applyReadingFilters() {
  readingPage = 1;
  if (adapter.mode === 'api') {
    try { await refreshApiData(); showError(''); }
    catch (error) { showError(error.message); }
  }
  render();
}
['#reading-search', '#reading-from', '#reading-to', '#reading-sort'].forEach((selector) => {
  document.querySelector(selector).addEventListener(selector === '#reading-search' ? 'input' : 'change', applyReadingFilters);
});
document.querySelector('#reading-prev').addEventListener('click', async () => {
  if (readingPage > 1) { readingPage -= 1; if (adapter.mode === 'api') await refreshApiData(); render(); }
});
document.querySelector('#reading-next').addEventListener('click', async () => {
  if (adapter.mode === 'api' ? readingHasMore : true) { readingPage += 1; if (adapter.mode === 'api') await refreshApiData(); render(); }
});

document.querySelector('#range-select').addEventListener('change', render);
document.querySelector('#scenario-increase').addEventListener('input', render);
document.querySelector('#battery-capacity').addEventListener('input', render);
document.querySelector('#emission-factor').addEventListener('input', (event) => { localStorage.setItem('drift.emission-factor', event.target.value); render(); });
document.querySelector('#emission-source').addEventListener('input', (event) => { localStorage.setItem('drift.emission-source', event.target.value); render(); });
document.querySelector('#tariff-mode').addEventListener('change', render);
document.querySelectorAll('.slab-from,.slab-to,.slab-rate').forEach((input) => input.addEventListener('input', render));
document.querySelector('#print-report').addEventListener('click', () => window.print());
document.querySelector('#shortcuts-help').addEventListener('click', () => window.alert('Shortcuts: Ctrl/Cmd + K opens quick actions. R focuses the reading form.'));
document.querySelector('#demo-data').hidden = adapter.mode === 'api';
document.querySelector('#demo-data').addEventListener('click', () => {
  const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  const demo = [];
  for (let day = 0; day < 7; day += 1) {
    const weather = [0.48, 0.73, 0.94, 0.61, 1, 0.82, 0.54][day];
    for (let hour = 0; hour < 24; hour += 1) {
      const from = new Date(start); from.setDate(start.getDate() + day); from.setHours(hour);
      const to = new Date(from); to.setHours(hour + 1);
      const daylight = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
      demo.push({periodStart:dateTimeInput(from),periodEnd:dateTimeInput(to),generatedKwh:Number((daylight * weather * 4.2).toFixed(3)),consumedKwh:Number((hour >= 18 && hour <= 22 ? 1.7 : .75).toFixed(3)),gridImportKwh:null,source:'DEMO'});
    }
  }
  state = { buildingName: 'Generated demo data · ' + state.buildingName, readings: demo };
  adapter.local.save(state); document.querySelector('#demo-label').hidden = false; render();
});
document.querySelector('#monthly-goal-input').addEventListener('input', (event) => {
  const value = Math.min(100, Math.max(1, Number(event.target.value) || 80));
  localStorage.setItem('drift.monthly-coverage-goal.' + (selectedBuildingId || 'preview'), String(value));
  render();
});
document.querySelector('#monthly-surplus-input').addEventListener('input', (event) => {
  const value = Math.max(0, Number(event.target.value) || 0);
  localStorage.setItem('drift.monthly-surplus-goal.' + (selectedBuildingId || 'preview'), String(value));
  render();
});
document.querySelector('#notification-button').addEventListener('click', () => {
  localStorage.setItem('drift.notices-read', JSON.stringify([...document.querySelectorAll('#notification-list li')].map((node) => node.textContent).filter((text) => text !== 'No new energy alerts.')));
  document.querySelector('#notification-center').showModal();
  document.querySelector('#notification-count').textContent = '0';
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); document.querySelector('#command-palette').showModal(); document.querySelector('#palette-search').focus();
  }
  if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'r' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    document.querySelector('#reading-form-panel').scrollIntoView({ behavior: 'smooth' }); startInput.focus();
  }
});
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('#command-palette').close();
  if (button.dataset.command === 'export') document.querySelector('#export-csv').click();
  else if (button.dataset.command === 'building') document.querySelector('#building-select').focus();
  else document.querySelector(button.dataset.command === 'readings' ? '#readings' : '#overview').scrollIntoView({ behavior: 'smooth' });
}));
rateInput.addEventListener('change', async () => {
  const value = rateInput.value.trim();
  if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000)) {
    showAdvancedStatus('Enter a rate between 0 and 1000 INR per kWh.');
    return;
  }
  localStorage.setItem(RATE_KEY, value);
  showAdvancedStatus('');
  if (adapter.mode === 'api' && selectedBuildingId) {
    try { await refreshApiData(); }
    catch (error) { showAdvancedStatus(error.message); }
  }
  render();
});
document.querySelector('#add-reading-top').addEventListener('click', () => {
  document.querySelector('#reading-form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  startInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const start = String(values.get('periodStart') || '');
  const end = String(values.get('periodEnd') || '');
  if (!start || !end || end <= start) {
    showError('The end time must be after the start time.');
    return;
  }
  const numberNames = [
    'generatedKwh', 'consumedKwh', 'gridImportKwh',
    'batteryChargeKwh', 'batteryDischargeKwh',
  ];
  for (const name of numberNames) {
    const value = values.get(name);
    if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      showError('Energy values must be valid numbers at or above zero.');
      return;
    }
  }
  if (state.readings.some((reading) => {
    const isEditingRow = editing && (editing.id != null
      ? reading.id === editing.id
      : reading === editing);
    return !isEditingRow && start < reading.periodEnd && end > reading.periodStart;
  })) {
    showError('That date range overlaps a reading already saved.');
    return;
  }

  const optionalNumber = (name) => {
    const value = values.get(name);
    return value === '' ? null : Number(value);
  };
  const next = {
    periodStart: start,
    periodEnd: end,
    generatedKwh: Number(values.get('generatedKwh')),
    consumedKwh: Number(values.get('consumedKwh')),
    gridImportKwh: optionalNumber('gridImportKwh'),
    batteryChargeKwh: optionalNumber('batteryChargeKwh'),
    batteryDischargeKwh: optionalNumber('batteryDischargeKwh'),
  };

  try {
    if (adapter.mode === 'api') {
      const payload = toApiReading(next);
      if (editing) await adapter.updateReading(selectedBuildingId, editing.id, payload);
      else await adapter.createReading(selectedBuildingId, payload);
      await refreshApiData();
    } else {
      if (editing) Object.assign(editing, next);
      else state.readings.push(next);
      state.readings.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      adapter.local.save(state);
    }
    resetForm();
    render();
  } catch (error) {
    showError(error.message);
  }
});

document.querySelector('#compare-buildings').addEventListener('click', async () => {
  if (!state.readings.length) {
    showAdvancedStatus('Add readings before comparing buildings.');
    return;
  }
  try {
    const starts = state.readings.map((row) => row.periodStart).sort();
    const ends = state.readings.map((row) => row.periodEnd).sort();
    const from = localDateTimeIso(starts[0], buildingTimezone);
    const to = localDateTimeIso(ends[ends.length - 1], buildingTimezone);
    const rows = await adapter.comparison(from, to, selectedRate());
    const target = document.querySelector('#comparison-results');
    target.replaceChildren();
    if (!rows.length) {
      target.textContent = 'No accessible buildings were found for this account.';
    } else {
      const dailySeries = await Promise.all(rows.map((item) => adapter.summary(item.buildingId, 'daily', from, to)
        .then((series) => series.slice(-7)).catch(() => [])));
      const weakestCoverage = Math.min(...rows.map((item) => item.solarCoveragePct == null ? 0 : numeric(item.solarCoveragePct)));
      const chart = document.createElement('div'); chart.className = 'comparison-chart';
      rows.forEach((item) => {
        const line = document.createElement('div'); line.className = 'comparison-bar-row';
        const name = document.createElement('span'); name.textContent = item.buildingName;
        const track = document.createElement('span'); track.className = 'comparison-track';
        const bar = document.createElement('i'); bar.style.width = Math.min(100, numeric(item.solarCoveragePct)) + '%';
        if (numeric(item.solarCoveragePct) === weakestCoverage) { bar.classList.add('weakest'); name.append(' · needs attention'); }
        track.append(bar);
        const pct = document.createElement('b'); pct.textContent = item.solarCoveragePct == null ? '—' : displayNumber(numeric(item.solarCoveragePct), 0) + '%';
        line.append(name, track, pct); chart.append(line);
      });
      target.append(chart);
      const table = document.createElement('table');
      const head = document.createElement('thead');
      const header = document.createElement('tr');
      ['Building', 'Generated', 'Consumed', 'Balance', 'Coverage', 'Missing', 'Est. grid cost'].forEach((name) => {
        const cell = document.createElement('th');
        cell.textContent = name;
        header.append(cell);
      });
      head.append(header);
      const body = document.createElement('tbody');
      rows.forEach((item, itemIndex) => {
        const row = document.createElement('tr');
        const values = [
          item.buildingName,
          displayNumber(numeric(item.generatedKwh)) + ' kWh',
          displayNumber(numeric(item.consumedKwh)) + ' kWh',
          displayNumber(numeric(item.energyBalanceKwh)) + ' kWh',
          item.solarCoveragePct == null ? '—' : displayNumber(numeric(item.solarCoveragePct), 1) + '%',
          String(numeric(item.missingPeriodCount)),
          item.estimatedGridCostInr == null ? '—' : '₹' + displayNumber(numeric(item.estimatedGridCostInr), 2),
        ];
        values.forEach((value, valueIndex) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          if (valueIndex === 0 && dailySeries[itemIndex].length) {
            const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            spark.setAttribute('viewBox', '0 0 70 20'); spark.setAttribute('class', 'sparkline'); spark.setAttribute('aria-label', 'Last seven days trend');
            const series = dailySeries[itemIndex]; const max = Math.max(1, ...series.map((point) => Math.abs(numeric(point.energyBalanceKwh))));
            const points = series.map((point, index) => (index * 70 / Math.max(1, series.length - 1)) + ',' + (10 - numeric(point.energyBalanceKwh) / max * 9)).join(' ');
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); polyline.setAttribute('points', points); polyline.setAttribute('fill', 'none'); polyline.setAttribute('stroke', '#58a6ff'); polyline.setAttribute('stroke-width', '2'); spark.append(polyline); cell.append(spark);
          }
          row.append(cell);
        });
        body.append(row);
      });
      table.append(head, body);
      target.append(table);
    }
    target.hidden = false;
    showAdvancedStatus('');
  } catch (error) {
    showAdvancedStatus(error.message);
  }
});

document.querySelector('#export-csv').addEventListener('click', async () => {
  try {
    const fromDay = document.querySelector('#export-from').value;
    const toDay = document.querySelector('#export-to').value;
    if (fromDay && toDay && fromDay > toDay) throw new Error('Export start date must be on or before the end date.');
    const from = fromDay ? fromDay + 'T00:00:00Z' : undefined;
    const to = toDay ? new Date(Date.parse(toDay + 'T00:00:00Z') + 86400000).toISOString() : undefined;
    const source = await adapter.exportCsv(adapter.mode === 'api' ? selectedBuildingId : null, from, to);
    const csv = await source.text();
    const lines = csv.trim().split(/\r?\n/);
    const headers = lines[0].split(',');
    const selected = [...document.querySelectorAll('#export-columns input:checked')].map((input) => input.value);
    const indexes = selected.map((name) => headers.indexOf(name)).filter((index) => index >= 0);
    if (!indexes.length) throw new Error('Choose at least one column to export.');
    const escapeCell = (value) => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    const filteredCsv = [indexes.map((index) => headers[index]).join(','), ...lines.slice(1).map((line) => {
      const cells = line.split(','); return indexes.map((index) => escapeCell(cells[index] || '')).join(',');
    })].join('\r\n') + '\r\n';
    const blob = new Blob([filteredCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = adapter.mode === 'api'
      ? 'drift-building-' + selectedBuildingId + '-readings.csv'
      : 'drift-preview-readings.csv';
    link.click();
    URL.revokeObjectURL(url);
    showAdvancedStatus('CSV export downloaded.');
  } catch (error) {
    showAdvancedStatus(error.message);
  }
});

document.querySelector('#import-csv').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await adapter.importCsv(
      adapter.mode === 'api' ? selectedBuildingId : null,
      await file.text(),
    );
    if (adapter.mode === 'api') await refreshApiData();
    else state = normalizeLocalState(adapter.local.load());
    render();
    showAdvancedStatus('Imported ' + result.imported + ' readings.');
  } catch (error) {
    showAdvancedStatus(error.message);
  } finally {
    event.target.value = '';
  }
});

function showAdvancedStatus(message) {
  advancedStatus.textContent = message;
  advancedStatus.hidden = !message;
}

document.querySelector('#cancel-edit').addEventListener('click', resetForm);
document.querySelector('#clear-data').addEventListener('click', () => {
  if (!state.readings.length && state.buildingName === 'My home') return;
  if (!window.confirm('Clear this browser’s saved Drift preview data?')) return;
  localStorage.removeItem('drift.frontend-preview.v1');
  state = { buildingName: 'My home', readings: [] };
  render();
});

window.addEventListener('resize', () => {
  if (!document.querySelector('#chart-wrap').hidden) render();
});

async function initialize() {
  if (adapter.mode === 'api') {
    document.querySelector('#mode-status').textContent = 'Connecting to API…';
    document.body.classList.add('loading');
    try {
      await refreshApiData();
      if (!adapter.userId) {
        showError('Set a demo user ID in the page address, for example ?mode=api&userId=1.');
      }
    } catch (error) {
      showError(error.message + (adapter.userId ? '' : ' Add ?mode=api&userId=1 to the page address.'));
      document.querySelector('#mode-status').textContent = 'API offline';
    } finally {
      document.body.classList.remove('loading');
    }
  }
  render();
}

window.addEventListener('offline', () => { if (adapter.mode === 'api') showError('You are offline. Reconnect to use the API dashboard.'); });
window.addEventListener('online', () => { if (adapter.mode === 'api') initialize(); });

initialize();
