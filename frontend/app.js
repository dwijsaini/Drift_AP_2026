const STORAGE_KEY = 'drift.frontend-preview.v1';
const today = new Date();
const dateInput = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

let state = loadState();
const form = document.querySelector('#reading-form');
const startInput = form.elements.periodStart;
const endInput = form.elements.periodEnd;
startInput.value = dateInput(new Date(today.getTime() - 86_400_000));
endInput.value = dateInput(today);

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? { buildingName: 'My home', readings: [] };
  } catch {
    return { buildingName: 'My home', readings: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function coverage(generated, consumed) {
  return consumed === 0 ? null : Math.min(100, generated / consumed * 100);
}

function displayNumber(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function render() {
  document.querySelector('#building-name').value = state.buildingName;
  document.querySelector('#crumb-building').textContent = state.buildingName || 'My home';
  const cutoff = new Date();
  const range = document.querySelector('#range-select').value;
  if (range !== 'all') cutoff.setDate(cutoff.getDate() - Number(range));
  const readings = [...state.readings]
    .filter((reading) => range === 'all' || new Date(`${reading.periodEnd}T23:59:59`) >= cutoff)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const generated = readings.reduce((sum, row) => sum + row.generatedKwh, 0);
  const consumed = readings.reduce((sum, row) => sum + row.consumedKwh, 0);
  const balance = generated - consumed;
  const percent = coverage(generated, consumed);
  document.querySelector('#total-generated').textContent = displayNumber(generated);
  document.querySelector('#total-consumed').textContent = displayNumber(consumed);
  const balanceCard = document.querySelector('.balance-card');
  balanceCard.classList.toggle('negative', balance < 0);
  document.querySelector('#total-balance').textContent = `${balance > 0 ? '+' : ''}${displayNumber(balance)}`;
  document.querySelector('#balance-note').textContent = balance < 0 ? 'Use exceeded solar generation' : 'Generation minus consumption';
  document.querySelector('#solar-coverage').textContent = percent === null ? '—' : displayNumber(percent, 0);
  document.querySelector('#coverage-unit').textContent = percent === null ? '' : '%';

  const body = document.querySelector('#readings-body');
  const sorted = [...state.readings].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  body.replaceChildren(...sorted.map((reading) => {
    const gap = reading.generatedKwh - reading.consumedKwh;
    const percentForRow = coverage(reading.generatedKwh, reading.consumedKwh);
    const row = document.createElement('tr');
    const values = [
      `${reading.periodStart} – ${reading.periodEnd}`,
      `${displayNumber(reading.generatedKwh)} kWh`,
      `${displayNumber(reading.consumedKwh)} kWh`,
      `${gap > 0 ? '+' : ''}${displayNumber(gap)} kWh`,
      percentForRow === null ? '—' : `${displayNumber(percentForRow, 0)}%`,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 3) cell.className = gap >= 0 ? 'positive' : 'negative-text';
      row.append(cell);
    });
    return row;
  }));
  document.querySelector('#table-empty').hidden = sorted.length > 0;
  const hasReadings = readings.length > 0;
  document.querySelector('#chart-empty').hidden = hasReadings;
  document.querySelector('#chart-wrap').hidden = !hasReadings;
  if (hasReadings) drawChart(readings);
  const recent = readings.slice(-3);
  const worsening = recent.length === 3 && recent.every((row) => row.consumedKwh > row.generatedKwh)
    && recent[1].consumedKwh - recent[1].generatedKwh > recent[0].consumedKwh - recent[0].generatedKwh
    && recent[2].consumedKwh - recent[2].generatedKwh > recent[1].consumedKwh - recent[1].generatedKwh;
  document.querySelector('#worsening-alert').hidden = !worsening;
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
    context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
  }
  const groupWidth = (right - left) / visible.length;
  const barWidth = Math.min(12, groupWidth * .25);
  visible.forEach((reading, index) => {
    const center = left + groupWidth * (index + .5);
    const generatedHeight = (reading.generatedKwh / max) * (bottom - top);
    const consumedHeight = (reading.consumedKwh / max) * (bottom - top);
    context.fillStyle = '#91b741';
    context.beginPath(); context.roundRect(center - barWidth - 1, bottom - generatedHeight, barWidth, generatedHeight, 4); context.fill();
    context.fillStyle = '#f0a17c';
    context.beginPath(); context.roundRect(center + 1, bottom - consumedHeight, barWidth, consumedHeight, 4); context.fill();
  });
  const labels = document.querySelector('#chart-labels');
  labels.replaceChildren(...visible.map((reading) => {
    const label = document.createElement('span');
    label.textContent = new Date(`${reading.periodEnd}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return label;
  }));
}

document.querySelector('#building-name').addEventListener('change', (event) => {
  state.buildingName = event.target.value.trim() || 'My home';
  saveState(); render();
});
document.querySelector('#range-select').addEventListener('change', render);
document.querySelector('#add-reading-top').addEventListener('click', () => {
  document.querySelector('#reading-form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  startInput.focus();
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const start = values.get('periodStart');
  const end = values.get('periodEnd');
  const error = document.querySelector('#form-error');
  if (end < start) {
    error.textContent = 'The end date must be on or after the start date.';
    error.hidden = false;
    return;
  }
  if (state.readings.some((reading) => start <= reading.periodEnd && end >= reading.periodStart)) {
    error.textContent = 'That date range overlaps a reading already saved.';
    error.hidden = false;
    return;
  }
  const numeric = (name) => Number(values.get(name) || 0);
  state.readings.push({
    periodStart: start, periodEnd: end,
    generatedKwh: numeric('generatedKwh'), consumedKwh: numeric('consumedKwh'),
    gridImportKwh: numeric('gridImportKwh'), batteryChargeKwh: numeric('batteryChargeKwh'),
    batteryDischargeKwh: numeric('batteryDischargeKwh'),
  });
  state.readings.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  saveState(); form.reset(); startInput.value = dateInput(new Date(Date.now() - 86_400_000)); endInput.value = dateInput(new Date());
  error.hidden = true; render();
});
document.querySelector('#clear-data').addEventListener('click', () => {
  if (!state.readings.length && state.buildingName === 'My home') return;
  if (!window.confirm('Clear this browser’s saved Drift preview data?')) return;
  localStorage.removeItem(STORAGE_KEY); state = { buildingName: 'My home', readings: [] }; render();
});
window.addEventListener('resize', () => { if (!document.querySelector('#chart-wrap').hidden) render(); });
render();
