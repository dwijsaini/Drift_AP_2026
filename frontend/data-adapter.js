// Data Adapter for Drift: isolates HTTP API details and browser-only preview storage.

const PREVIEW_KEY = 'drift.frontend-preview.v1';
const SELECTED_BUILDING_KEY = 'drift.api-building-id';
const USER_KEY = 'drift.api-user-id';
const THEME_KEY = 'drift.theme';
const GOALS_KEY = 'drift.goals';
const SLABS_KEY = 'drift.tariff-slabs';

const params = new URLSearchParams(window.location.search);
const apiMode = params.get('mode') === 'api';
let apiUserId = params.get('userId') || localStorage.getItem(USER_KEY) || '1';
if (params.get('userId')) {
  localStorage.setItem(USER_KEY, params.get('userId'));
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (apiUserId) {
    headers.set('X-User-Id', apiUserId);
  }

  const response = await fetch('/api' + path, { ...init, headers });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'Request failed (' + response.status + ')');
    error.status = response.status;
    error.details = body?.error?.details;
    throw error;
  }
  return body?.data !== undefined ? body : body;
}

function queryString(values) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

const local = {
  load() {
    try {
      const data = JSON.parse(localStorage.getItem(PREVIEW_KEY));
      return data && typeof data === 'object' ? data : { buildingName: 'My home', readings: [] };
    } catch {
      return { buildingName: 'My home', readings: [] };
    }
  },
  save(state) {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(state));
  },
  clear() {
    localStorage.removeItem(PREVIEW_KEY);
  },
  getGoals(buildingId = 'default') {
    try {
      const all = JSON.parse(localStorage.getItem(GOALS_KEY)) || {};
      return all[buildingId] || { targetCoveragePct: 80, targetSurplusKwh: 150 };
    } catch {
      return { targetCoveragePct: 80, targetSurplusKwh: 150 };
    }
  },
  saveGoals(buildingId = 'default', goals) {
    try {
      const all = JSON.parse(localStorage.getItem(GOALS_KEY)) || {};
      all[buildingId] = goals;
      localStorage.setItem(GOALS_KEY, JSON.stringify(all));
    } catch {}
  },
  getSlabs() {
    try {
      return JSON.parse(localStorage.getItem(SLABS_KEY)) || [
        { from: 0, to: 50, rate: 4.15 },
        { from: 51, to: 100, rate: 5.60 },
        { from: 101, to: 200, rate: 7.15 },
        { from: 201, to: null, rate: 8.50 }
      ];
    } catch {
      return [
        { from: 0, to: 50, rate: 4.15 },
        { from: 51, to: 100, rate: 5.60 },
        { from: 101, to: 200, rate: 7.15 },
        { from: 201, to: null, rate: 8.50 }
      ];
    }
  },
  saveSlabs(slabs) {
    localStorage.setItem(SLABS_KEY, JSON.stringify(slabs));
  }
};

export const adapter = {
  mode: apiMode ? 'api' : 'local',
  get userId() { return apiUserId; },
  setUserId(id) {
    apiUserId = String(id);
    localStorage.setItem(USER_KEY, apiUserId);
  },
  local,
  selectedBuildingId() {
    return localStorage.getItem(SELECTED_BUILDING_KEY);
  },
  setSelectedBuildingId(id) {
    if (id) localStorage.setItem(SELECTED_BUILDING_KEY, String(id));
    else localStorage.removeItem(SELECTED_BUILDING_KEY);
  },
  async buildings() {
    if (!apiMode) return [];
    const res = await request('/buildings');
    return res.data || [];
  },
  async createBuilding(value) {
    const res = await request('/buildings', { method: 'POST', body: JSON.stringify(value) });
    return res.data || res;
  },
  async readings(buildingId, options = {}) {
    const query = queryString(options);
    const res = await request('/buildings/' + encodeURIComponent(buildingId) + '/readings' + (query ? '?' + query : ''));
    return res;
  },
  async createReading(buildingId, value) {
    const res = await request('/buildings/' + encodeURIComponent(buildingId) + '/readings', {
      method: 'POST',
      body: JSON.stringify(value)
    });
    return res.data || res;
  },
  async updateReading(buildingId, readingId, value) {
    const res = await request('/buildings/' + encodeURIComponent(buildingId) + '/readings/' + encodeURIComponent(readingId), {
      method: 'PATCH',
      body: JSON.stringify(value)
    });
    return res.data || res;
  },
  async deleteReading(buildingId, readingId) {
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings/' + encodeURIComponent(readingId), {
      method: 'DELETE'
    });
  },
  async summary(buildingId, granularity, from, to, electricityRateInrPerKwh) {
    const query = queryString({ from, to, electricityRateInrPerKwh });
    const res = await request('/buildings/' + encodeURIComponent(buildingId) + '/summaries/' + encodeURIComponent(granularity) + '?' + query);
    return res.data || [];
  },
  async comparison(from, to, electricityRateInrPerKwh) {
    const query = queryString({ from, to, electricityRateInrPerKwh });
    const res = await request('/buildings/comparison?' + query);
    return res.data || [];
  },
  async importCsv(buildingId, csv) {
    const res = await request('/buildings/' + encodeURIComponent(buildingId) + '/readings.csv', {
      method: 'POST',
      body: JSON.stringify({ csv })
    });
    return res.data || res;
  },
  async exportCsv(buildingId, options = {}) {
    const query = queryString(options);
    const headers = new Headers();
    if (apiUserId) headers.set('X-User-Id', apiUserId);
    const response = await fetch('/api/buildings/' + encodeURIComponent(buildingId) + '/readings.csv' + (query ? '?' + query : ''), { headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error?.message || 'CSV export failed (' + response.status + ')');
    }
    return response.blob();
  }
};
