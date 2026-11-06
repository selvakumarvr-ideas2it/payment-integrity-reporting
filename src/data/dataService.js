import { config } from '../config.js';
import { buildReport, MEASURES, toList } from './schema.js';
import { parseCsvText, parseCsvFile } from './csv.js';
import { apiFetch, fetchWithTimeout } from './apiClient.js';

export const SOURCES = {
  api: 'Function API',
  json: 'JSON file',
  csv: 'CSV file',
};

export function financialImpactPath(clientId) {
  return `/api/v1/clients/${clientId ?? 1}/financial-impact`;
}

/**
 * Request sent to POST /api/v1/clients/{clientId}/financial-impact.
 * Client id is on the URL; filters come from the page (including a selected dataset).
 */
export function buildApiRequest({ filters, user }) {
  const apiFilters = [];
  for (const attributeKey of ['market', 'programType']) {
    const values = toList(filters?.[attributeKey]);
    if (values.length) apiFilters.push({ attributeKey, values });
  }
  return {
    lineOfBusinessId: config.lineOfBusinessId,
    userId: user?.id ?? 1,
    measures: MEASURES.map((m) => m.key),
    aggregates: [{ attributeKey: 'month' }],
    filters: apiFilters,
    months: 24,
  };
}

async function fromApi({ filters, user }) {
  const key = config.queryApi.key;
  if (!key) {
    throw new Error('Function API key is not set. Add VITE_QUERY_API_KEY to .env.local and restart npm run dev.');
  }
  const path = financialImpactPath(user?.customerId);
  const json = await apiFetch(`${path}?code=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: buildApiRequest({ filters, user }),
    // Do not send the App API bearer token; Azure Functions treat it as 401.
    auth: false,
    // Dev stays same-origin so Vite can proxy /api/v1 to the Function App origin.
    baseUrl: import.meta.env.VITE_QUERY_API_BASE_URL ? '' : config.queryApi.baseUrl,
    apiKey: key,
    timeoutMs: config.queryApi.timeoutMs,
  });
  return {
    ...buildReport({
      rawRows: json.rows ?? json.data ?? [],
      kpis: json.kpis,
      filterOptions: json.filterOptions,
      report: json.report,
      filters,
      applyFilters: false, // the stored procedure applies filters server-side
      source: 'api',
    }),
    dataset: json.dataset ?? null,
  };
}

async function fetchOk(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res;
}

async function fromJson({ filters }) {
  const json = await (await fetchOk(config.jsonUrl)).json();
  return buildReport({
    rawRows: Array.isArray(json) ? json : json.rows ?? json.data ?? [],
    kpis: Array.isArray(json) ? undefined : json.kpis,
    filterOptions: json.filterOptions,
    report: json.report,
    filters,
    applyFilters: true,
    source: 'json',
  });
}

async function fromCsvUrl({ filters }) {
  const rows = parseCsvText(await (await fetchOk(config.csvUrl)).text());
  return buildReport({ rawRows: rows, filters, applyFilters: true, source: 'csv' });
}

/** Load the Savings Invoice report from the chosen source. */
export async function loadSavingsInvoice({ source, filters, user, uploadedRows }) {
  if (uploadedRows) {
    return buildReport({ rawRows: uploadedRows, filters, applyFilters: true, source: 'upload' });
  }
  switch (source) {
    case 'api':
      return fromApi({ filters, user });
    case 'csv':
      return fromCsvUrl({ filters });
    case 'json':
    default:
      return fromJson({ filters });
  }
}

export { parseCsvFile };
