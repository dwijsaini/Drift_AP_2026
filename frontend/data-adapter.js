// Keep HTTP details and browser-only storage out of the dashboard.
const KEY = 'drift.frontend-preview.v1';
const SELECTED_BUILDING_KEY = 'drift.api-building-id';
const params = new URLSearchParams(window.location.search);
const apiMode = params.get('mode') === 'api';
let apiUserId = params.get('userId') || localStorage.getItem('drift.api-user-id') || '';

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (apiUserId) headers.set('X-User-Id', apiUserId);
  const response = await fetch('/api' + path, { ...init, headers });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || 'Request failed (' + response.status + ')');
  }
  return body?.data ?? body;
}

const local = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { buildingName: 'My home', readings: [] };
    } catch {
      return { buildingName: 'My home', readings: [] };
    }
  },
  save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  },
};

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
  readings(buildingId) {
    return request('/buildings/' + encodeURIComponent(buildingId) + '/readings');
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
  summary(buildingId, granularity, from, to) {
    const query = '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    return request('/buildings/' + encodeURIComponent(buildingId) +
      '/summaries/' + encodeURIComponent(granularity) + query);
  },
};
