const API_BASE = (import.meta.env.VITE_EDGE_URL || 'http://localhost:8000').replace(/\/$/, '');

async function request(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { detail: raw }; }
    if (!response.ok) {
      const error = new Error(data?.detail || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Request timed out. Check the edge device and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export const api = {
  health: () => request('/', {}, 5000),
  predict: () => request('/predict', {}, 60000),
  records: () => request('/data', {}, 15000),
  label: (id, label) => request(`/true-label-update/${id}?true_label=${label}`, { method: 'PUT' }, 15000),
  train: () => request('/local-train', {}, 300000),
  aggregate: () => request('/aggregate-weights', { method: 'POST' }, 150000)
};

export const LABELS = {
  0: { code: 'F', name: 'Fusion beat', tone: 'amber' },
  1: { code: 'N', name: 'Normal', tone: 'green' },
  2: { code: 'Q', name: 'Unknown / unclassifiable', tone: 'amber' },
  3: { code: 'S', name: 'Supraventricular ectopic', tone: 'amber' },
  4: { code: 'V', name: 'Ventricular ectopic', tone: 'red' }
};

export function asRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return [];
}
export function validSpo2(payload) {
  return (Array.isArray(payload) ? payload : [])
    .flatMap(window => Array.isArray(window) ? window : [])
    .filter(value => Number.isFinite(Number(value)) && Number(value) >= 50 && Number(value) <= 100)
    .map(Number);
}