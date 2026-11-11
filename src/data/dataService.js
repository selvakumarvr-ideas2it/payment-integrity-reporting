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
 * `aggregates` and `extraFilters` let the details page group by market/program type
 * and restrict to the clicked month without changing the summary payload.
 */
const FILTER_ATTRIBUTES = ['market', 'programType'];

function stringList(v) {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

/** Dropdown lists from the Function API (`filterOptions`) or Snowflake (`attributeValues`). */
export function pickFilterOptions(json) {
  const src = json?.filterOptions ?? json?.attributeValues ?? {};
  return {
    market: stringList(src.market),
    programType: stringList(src.programType),
  };
}

export function buildApiRequest({ filters, user, aggregates, extraFilters = [] }) {
  const apiFilters = [];
  for (const attributeKey of FILTER_ATTRIBUTES) {
    const values = toList(filters?.[attributeKey]);
    if (values.length) apiFilters.push({ attributeKey, values });
  }
  for (const f of extraFilters) {
    const values = toList(f?.values);
    if (f?.attributeKey && values.length)
      apiFilters.push({ attributeKey: f.attributeKey, values, ...(f.operator ? { operator: f.operator } : {}) });
  }
  return {
    lineOfBusinessId: config.lineOfBusinessId,
    userId: user?.id ?? 1,
    measures: MEASURES.map((m) => m.key),
    aggregates: aggregates ?? [{ attributeKey: 'month' }],
    filters: apiFilters,
    months: 24,
    // Distinct values for the Market / Program Type dropdowns. Rows are grouped by month only,
    // so these cannot be inferred from the table.
    attributeValues: FILTER_ATTRIBUTES,
  };
}

/** POST to the Azure Function App using the same URL, key and proxy as the summary page. */
export async function queryFinancialImpact({ filters, user, aggregates, extraFilters }) {
  const key = config.queryApi.key;
  if (!key) {
    throw new Error('Function API key is not set. Add VITE_QUERY_API_KEY to .env.local and restart npm run dev.');
  }
  const path = financialImpactPath(user?.customerId);
  return apiFetch(`${path}?code=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: buildApiRequest({ filters, user, aggregates, extraFilters }),
    // Do not send the App API bearer token; Azure Functions treat it as 401.
    auth: false,
    // Dev stays same-origin so Vite can proxy /api/v1 to the Function App origin.
    baseUrl: import.meta.env.VITE_QUERY_API_BASE_URL ? '' : config.queryApi.baseUrl,
    apiKey: key,
    timeoutMs: config.queryApi.timeoutMs,
  });
}

async function fromApi({ filters, user, extraFilters }) {
  const json = await queryFinancialImpact({ filters, user, extraFilters });
  return {
    ...buildReport({
      rawRows: json.rows ?? json.data ?? [],
      kpis: json.kpis,
      filterOptions: pickFilterOptions(json),
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

function withMonthRange(filters, monthRange) {
  return { ...filters, monthFrom: monthRange?.start, monthTo: monthRange?.end };
}

function periodExtraFilters(monthRange) {
  if (!monthRange?.start || !monthRange?.end) return [];
  return [{ attributeKey: 'month', operator: 'BETWEEN', values: [monthRange.start, monthRange.end] }];
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
export async function loadSavingsInvoice({ source, filters, user, uploadedRows, monthRange }) {
  const scoped = withMonthRange(filters, monthRange);
  if (uploadedRows) {
    return buildReport({ rawRows: uploadedRows, filters: scoped, applyFilters: true, source: 'upload' });
  }
  switch (source) {
    case 'api':
      return fromApi({ filters, user, extraFilters: periodExtraFilters(monthRange) });
    case 'csv':
      return fromCsvUrl({ filters: scoped });
    case 'json':
    default:
      return fromJson({ filters: scoped });
  }
}

export { parseCsvFile };
