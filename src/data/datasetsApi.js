import { apiFetch } from './apiClient.js';

/** Page filter state { market: [], programType: [] } <-> API filter list [{ attributeKey, values }]. */
export const toFilterList = (filters) =>
  Object.entries(filters)
    .filter(([, values]) => values?.length)
    .map(([attributeKey, values]) => ({ attributeKey, values: [...values].sort() }));

export const fromFilterList = (list = []) => {
  const out = { market: [], programType: [] };
  for (const f of list) out[f.attributeKey] = [...f.values].sort();
  return out;
};

export const sameFilters = (a, b) => JSON.stringify(toFilterList(a)) === JSON.stringify(toFilterList(b));

export const listDatasets = () => apiFetch('/datasets').then((r) => r.datasets);
export const createDataset = ({ name, description, filters }) =>
  apiFetch('/datasets', { method: 'POST', body: { name, description, filters: toFilterList(filters) } });
export const updateDataset = (id, { name, description, filters }) =>
  apiFetch(`/datasets/${id}`, {
    method: 'PUT',
    body: { name, description, ...(filters ? { filters: toFilterList(filters) } : {}) },
  });
export const deleteDataset = (id) => apiFetch(`/datasets/${id}`, { method: 'DELETE' });
