// Keep HTTP details and browser-only storage out of the dashboard.
const KEY = 'drift.frontend-preview.v1';
const SELECTED_BUILDING_KEY = 'drift.api-building-id';
const params = new URLSearchParams(window.location.search);
const apiMode = params.get('mode') === 'api';
let apiUserId = params.get('userId') || localStorage.getItem('drift.api-user-id') || '';

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (apiUserId) headers.set('X-User-Id', apiUserId);
  const response = await fetch('/api' + path, { ...init, headers });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || 'Request failed (' + response.status + ')');
  return body?.data ?? body;
}

async function requestPage(path) {
  const headers = new Headers();
  if (apiUserId) headers.set('X-User-Id', apiUserId);
  const response = await fetch('/api' + path, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || 'Request failed (' + response.status + ')');
  return { data: body.data || [], meta: body.meta || {} };
}

const local = {
  load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { buildingName: 'My home', readings: [] }; }
    catch { return { buildingName: 'My home', readings: [] }; }
  },
  save(state) { localStorage.setItem(KEY, JSON.stringify(state)); },
};

function queryString(values) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return query.toString();
}

const CSV_HEADERS = [
  'periodStart', 'periodEnd', 'generatedKwh', 'consumedKwh', 'gridImportKwh',
  'batteryChargeKwh', 'batteryDischargeKwh', 'source',
];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text).replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      if (cell !== '') throw new Error('CSV has an unexpected quote.');
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  if (!rows.length || rows[0].length !== CSV_HEADERS.length ||
      CSV_HEADERS.some((header, index) => rows[0][index] !== header)) {
    throw new Error('CSV headers must be exactly: ' + CSV_HEADERS.join(','));
  }
  if (rows.length < 2 || rows.length > 10001) {
    throw new Error('CSV must contain 1 to 10000 readings.');
  }
  return rows.slice(1).map((values, index) => {
    if (values.length !== CSV_HEADERS.length) throw new Error('Invalid CSV row ' + (index + 2) + '.');
    const record = Object.fromEntries(CSV_HEADERS.map((header, column) => [header, values[column]]));
    for (const field of ['generatedKwh', 'consumedKwh']) {
      const number = Number(record[field]);
      if (record[field] === '' || !Number.isFinite(number) || number < 0 || number > 999999) {
        throw new Error('Invalid ' + field + ' in CSV row ' + (index + 2) + '.');
      }
      record[field] = number;
    }
    for (const field of ['gridImportKwh', 'batteryChargeKwh', 'batteryDischargeKwh']) {
      if (record[field] === '') record[field] = null;
      else {
        const number = Number(record[field]);
        if (!Number.isFinite(number) || number < 0 || number > 999999) {
          throw new Error('Invalid ' + field + ' in CSV row ' + (index + 2) + '.');
        }
        record[field] = number;
      }
    }
    const start = Date.parse(record.periodStart);
    const end = Date.parse(record.periodEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 365 * 86400000) {
      throw new Error('Invalid period in CSV row ' + (index + 2) + '.');
    }
    record.periodStart = toLocalDateTime(start);
    record.periodEnd = toLocalDateTime(end);
    record.source = record.source || 'IMPORT';
    if (!['MANUAL', 'IMPORT', 'API'].includes(record.source)) {
      throw new Error('Invalid source in CSV row ' + (index + 2) + '.');
    }
    return record;
  });
}

function toLocalDateTime(value) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function localCsvRows(readings) {
  return [CSV_HEADERS.join(','), ...readings.map((reading) => [
    new Date(reading.periodStart).toISOString(),
    new Date(reading.periodEnd).toISOString(),
    reading.generatedKwh,
    reading.consumedKwh,
    reading.gridImportKwh,
    reading.batteryChargeKwh,
    reading.batteryDischargeKwh,
    reading.source || 'MANUAL',
  ].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

function importLocalCsv(text) {
  const imported = parseCsv(text);
  const existing = local.load();
  const combined = [...existing.readings, ...imported].sort((a, b) =>
    a.periodStart.localeCompare(b.periodStart));
  for (let index = 1; index < combined.length; index += 1) {
    if (combined[index].periodStart < combined[index - 1].periodEnd) {
      throw new Error('CSV readings overlap an existing or imported reading.');
    }
  }
  const readings = [...existing.readings, ...imported.map((reading) => ({
    ...reading,
    id: 'local-' + globalThis.crypto.randomUUID(),
  }))];
  local.save({ ...existing, readings });
  return { imported: imported.length };
}

function exportLocalCsv(from, to) {
  const rows = local.load().readings.filter((row) => (!from || row.periodStart >= from) && (!to || row.periodStart < to));
  return new Blob([localCsvRows(rows)], { type: 'text/csv;charset=utf-8' });
}

export const adapter = {
  mode: apiMode ? 'api' : 'local',
  get userId() { return apiUserId; },
  local,
  selectedBuildingId() { return localStorage.getItem(SELECTED_BUILDING_KEY); },
  setSelectedBuildingId(id) {
    if (id) localStorage.setItem(SELECTED_BUILDING_KEY, String(id));
    else localStorage.removeItem(SELECTED_BUILDING_KEY);
  },
  buildings() { return apiMode ? request('/buildings') : Promise.resolve([]); },
  createBuilding(value) {
    return request('/buildings', { method: 'POST', body: JSON.stringify(value) });
  },
  readings(buildingId, filters = {}) {
    const query = queryString(filters);
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings?' + query);
  },
  readingPage(buildingId, filters = {}) {
    const query = queryString(filters);
    return requestPage('/buildings/' + encodeURIComponent(buildingId) + '/readings?' + query);
  },
  createReading(buildingId, value) {
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings', {
      method: 'POST', body: JSON.stringify(value),
    });
  },
  updateReading(buildingId, readingId, value) {
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings/' +
      encodeURIComponent(readingId), { method: 'PATCH', body: JSON.stringify(value) });
  },
  deleteReading(buildingId, readingId) {
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings/' +
      encodeURIComponent(readingId), { method: 'DELETE' });
  },
  summary(buildingId, granularity, from, to, electricityRateInrPerKwh) {
    const query = queryString({ from, to, electricityRateInrPerKwh });
    return request('/buildings/' + encodeURIComponent(buildingId) +
      '/summaries/' + encodeURIComponent(granularity) + '?' + query);
  },
  comparison(from, to, electricityRateInrPerKwh) {
    const query = queryString({ from, to, electricityRateInrPerKwh });
    return request('/buildings/comparison?' + query);
  },
  importCsv(buildingId, csv) {
    if (!apiMode) return Promise.resolve(importLocalCsv(csv));
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings.csv', {
      method: 'POST', body: JSON.stringify({ csv }),
    });
  },
  async exportCsv(buildingId, from, to) {
    if (!apiMode) return exportLocalCsv(from, to);
    const headers = new Headers();
    if (apiUserId) headers.set('X-User-Id', apiUserId);
    const query = queryString({ from, to });
    const response = await fetch('/api/buildings/' + encodeURIComponent(buildingId) + '/readings.csv' + (query ? '?' + query : ''), { headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || 'CSV export failed (' + response.status + ')');
    }
    return response.blob();
  },
};

