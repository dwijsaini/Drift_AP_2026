// All persistence and HTTP mapping lives here so the UI can switch modes without
// coupling components to endpoint details. Enable API mode with ?mode=api.
const KEY = 'drift.frontend-preview.v1';
const params = new URLSearchParams(location.search);
const apiMode = params.get('mode') === 'api';
const userId = params.get('userId') || localStorage.getItem('drift.api-user-id') || '';
export function setApiUserId(value) { localStorage.setItem('drift.api-user-id', value); }
const request = async (path, init) => {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(userId ? { 'X-User-Id': userId } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Request failed (${response.status})`);
  return body.data ?? body;
};
const local = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) ?? { buildingName: 'My home', readings: [] }; } catch { return { buildingName: 'My home', readings: [] }; } },
  save(state) { localStorage.setItem(KEY, JSON.stringify(state)); },
};
export const adapter = {
  mode: apiMode ? 'api' : 'local',
  local,
  async buildings() { return apiMode ? request('/buildings') : [{ id: 'local', name: local.load().buildingName }]; },
  async readings(id) { return apiMode ? request(`/buildings/${id}/readings`) : local.load().readings; },
  createReading(id, value) { return apiMode ? request(`/buildings/${id}/readings`, { method: 'POST', body: JSON.stringify(value) }) : Promise.resolve(value); },
  updateReading(id, value) { return apiMode ? request(`/buildings/${window.driftBuildingId}/readings/${id}`, { method: 'PATCH', body: JSON.stringify(value) }) : Promise.resolve(value); },
  deleteReading(id) { return apiMode ? request(`/buildings/${window.driftBuildingId}/readings/${id}`, { method: 'DELETE' }) : Promise.resolve(); },
  summary(id, from, to) { return request(`/buildings/${id}/summaries/daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); },
};
