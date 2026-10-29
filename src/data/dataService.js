import { config } from '../config.js';
import { buildReport, MEASURES, toList } from './schema.js';
import { parseCsvText, parseCsvFile } from './csv.js';
import { apiFetch, fetchWithTimeout } from './apiClient.js';

export const SOURCES = {
  api: 'Function API',
  json: 'JSON file',
  csv: 'CSV file',
};

/**
 * Request sent to the Query API, which passes it to the BI_Engine stored procedure.
 * The measures / filters / aggregates shape mirrors Core's executeQuery contract.
 * With `datasetId` the procedure loads that saved dataset's filters itself.
 */
export function buildApiRequest({ filters, datasetId }) {
  const apiFilters = [];
  for (const attributeKey of ['market', 'programType']) {
    const values = toList(filters?.[attributeKey]);
    if (values.length) apiFilters.push({ attributeKey, values });
  }
  return {
    reportId: 'savings-invoice',
    ...(datasetId ? { datasetId } : {}),
    measures: MEASURES.map((m) => m.key),
    aggregates: [{ attributeKey: 'month', grain: 'month' }],
    filters: apiFilters,
    months: 24,
  };
}

async function fromApi({ filters, datasetId }) {
  const json = await apiFetch(config.api.queryPath, { method: 'POST', body: buildApiRequest({ filters, datasetId }) });
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

/** Load the Savings Invoice report from the chosen source. `datasetId` is used by the API source only. */
export async function loadSavingsInvoice({ source, filters, datasetId, uploadedRows }) {
  if (uploadedRows) {
    return buildReport({ rawRows: uploadedRows, filters, applyFilters: true, source: 'upload' });
  }
  switch (source) {
    case 'api':
      return fromApi({ filters, datasetId });
    case 'csv':
      return fromCsvUrl({ filters });
    case 'json':
    default:
      return fromJson({ filters });
  }
}

export { parseCsvFile };
