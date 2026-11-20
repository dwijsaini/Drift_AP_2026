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
  };
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
      generatedKwh: 0, consumedKwh: 0,
    };
    group.generatedKwh += numeric(row.generatedKwh);
    group.consumedKwh += numeric(row.consumedKwh);
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
  const rows = await adapter.readings(selectedBuildingId);
  state = {
    buildingName: selected.name || 'Building',
    readings: rows.map((row) => mapApiReading(row, buildingTimezone)),
  };

  if (!state.readings.length) return;
  const first = state.readings.reduce((value, row) =>
    row.periodStart < value ? row.periodStart : value, state.readings[0].periodStart);
  const last = state.readings.reduce((value, row) =>
    row.periodEnd > value ? row.periodEnd : value, state.readings[0].periodEnd);
  const from = localDateTimeIso(first, buildingTimezone);
  const to = localDateTimeIso(last, buildingTimezone);
  const granularities = ['daily', 'weekly', 'monthly'];
  const results = await Promise.allSettled(granularities.map((unit) =>
    adapter.summary(selectedBuildingId, unit, from, to)));
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
  const max = Math.max(1, ...visible.flatMap((row) => [row.generatedKwh, row.consumedKwh]));
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
  const labels = document.querySelector('#chart-labels');
  labels.replaceChildren(...visible.map((reading) => {
    const label = document.createElement('span');
    label.textContent = new Date(reading.periodEnd.slice(0, 10) + 'T12:00:00Z')
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return label;
  }));
}

function render() {
  const apiMode = adapter.mode === 'api';
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

  const body = document.querySelector('#readings-body');
  const sorted = [...state.readings].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  body.replaceChildren(...sorted.map((reading) => {
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

document.querySelector('#manage-building').addEventListener('click', async () => {
  const name = window.prompt(
    adapter.mode === 'api' ? 'New building name' : 'Building name',
    adapter.mode === 'api' ? '' : state.buildingName,
  );
  if (!name?.trim()) return;
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

document.querySelector('#range-select').addEventListener('change', render);
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
    try {
      await refreshApiData();
      if (!adapter.userId) {
        showError('Set a demo user ID in the page address, for example ?mode=api&userId=1.');
      }
    } catch (error) {
      showError(error.message + (adapter.userId ? '' : ' Add ?mode=api&userId=1 to the page address.'));
    }
  }
  render();
}

initialize();
