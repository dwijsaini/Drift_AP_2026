import { adapter } from './data-adapter.js';

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
    return adapter.local.load();
  } catch {
    return { buildingName: 'My home', readings: [] };
  }
}

function saveState() {
  adapter.local.save(state);
}

function coverage(generated, consumed) {
  return consumed === 0 ? null : Math.min(100, generated / consumed * 100);
}

function displayNumber(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function aggregateReadings(rows, granularity) {
  if (granularity === 'all') return rows.sort((a,b)=>a.periodStart.localeCompare(b.periodStart));
  const groups = new Map();
  for (const row of rows) {
    const d = new Date(`${row.periodStart}T12:00:00`);
    let key;
    if (granularity === 'daily') key = row.periodStart;
    else if (granularity === 'monthly') key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    else { const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay()+6)%7)); key = dateInput(monday); }
    const group = groups.get(key) || { ...row, id: key, periodStart: key, periodEnd: key, generatedKwh: 0, consumedKwh: 0 };
    group.generatedKwh += Number(row.generatedKwh); group.consumedKwh += Number(row.consumedKwh);
    const end = row.periodEnd > group.periodEnd ? row.periodEnd : group.periodEnd;
    group.periodEnd = end; groups.set(key, group);
  }
  return [...groups.values()].sort((a,b)=>a.periodStart.localeCompare(b.periodStart));
}

function render() {
  document.querySelector('#building-select').innerHTML = `<option value="local">${state.buildingName}</option>`;
  document.querySelector('#crumb-building').textContent = state.buildingName || 'My home';
  const range = document.querySelector('#range-select').value;
  const readings = aggregateReadings([...state.readings], range);
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
    const actions = document.createElement('td');
    const edit = document.createElement('button'); edit.type='button'; edit.className='text-button'; edit.textContent='Edit'; edit.onclick=()=>editReading(reading);
    const remove = document.createElement('button'); remove.type='button'; remove.className='text-button'; remove.textContent='Delete'; remove.onclick=()=>{ if(confirm('Delete this reading?')) { state.readings=state.readings.filter(r=>r!==reading); saveState(); render(); } };
    actions.append(edit, remove); row.append(actions);
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

document.querySelector('#manage-building').addEventListener('click', () => { const value=prompt('Building name', state.buildingName); if(value?.trim()){state.buildingName=value.trim();saveState();render();} });
if (adapter.mode === 'api') document.querySelector('#mode-status').textContent='API mode';
let editing = null;
function editReading(reading){ editing=reading; for(const key of ['periodStart','periodEnd','generatedKwh','consumedKwh','gridImportKwh','batteryChargeKwh','batteryDischargeKwh']) form.elements[key].value=reading[key] ?? ''; document.querySelector('#reading-form-panel').scrollIntoView({behavior:'smooth'}); }
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
  if (!start || !end || end < start) {
    error.textContent = 'The end date must be on or after the start date.';
    error.hidden = false;
    return;
  }
  if (['generatedKwh','consumedKwh','gridImportKwh','batteryChargeKwh','batteryDischargeKwh'].some(n => values.get(n) !== '' && Number(values.get(n)) < 0)) { error.textContent='Energy values must be zero or greater.'; error.hidden=false; return; }
  if (state.readings.some((reading) => reading !== editing && start <= reading.periodEnd && end >= reading.periodStart)) {
    error.textContent = 'That date range overlaps a reading already saved.';
    error.hidden = false;
    return;
  }
  const numeric = (name) => Number(values.get(name) || 0);
  const next = {
    periodStart: start, periodEnd: end,
    generatedKwh: numeric('generatedKwh'), consumedKwh: numeric('consumedKwh'),
    gridImportKwh: numeric('gridImportKwh'), batteryChargeKwh: numeric('batteryChargeKwh'),
    batteryDischargeKwh: numeric('batteryDischargeKwh'),
  };
  if(editing) Object.assign(editing,next); else state.readings.push(next); editing=null;
  state.readings.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  saveState(); form.reset(); startInput.value = dateInput(new Date(Date.now() - 86_400_000)); endInput.value = dateInput(new Date());
  error.hidden = true; render();
});
document.querySelector('#clear-data').addEventListener('click', () => {
  if (!state.readings.length && state.buildingName === 'My home') return;
  if (!window.confirm('Clear this browser’s saved Drift preview data?')) return;
  localStorage.removeItem('drift.frontend-preview.v1'); state = { buildingName: 'My home', readings: [] }; render();
});
window.addEventListener('resize', () => { if (!document.querySelector('#chart-wrap').hidden) render(); });
render();
