const env = import.meta.env;

const DEFAULT_QUERY_ORIGIN = 'https://func-hpm-api-001.azurewebsites.net';

/** Function App origin only — no path. `/api` suffix from older env files is stripped. */
function queryOrigin(value) {
  return String(value || DEFAULT_QUERY_ORIGIN)
    .trim()
    .replace(/\/$/, '')
    .replace(/\/api$/i, '');
}

function functionKey(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

export const config = {
  defaultSource: env.VITE_DATA_SOURCE || 'api',
  api: {
    // App API (auth + datasets). '/api' is proxied to :7071 in vite.config.js.
    baseUrl: (env.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
    key: functionKey(env.VITE_API_KEY),
    timeoutMs: Number(env.VITE_API_TIMEOUT_MS || 60000),
  },
  queryApi: {
    // Azure Function App origin. Path is built in financialImpactPath().
    baseUrl: queryOrigin(env.VITE_QUERY_API_BASE_URL),
    key: functionKey(env.VITE_QUERY_API_KEY || env.VITE_API_KEY),
    timeoutMs: Number(env.VITE_API_TIMEOUT_MS || 60000),
  },
  lineOfBusinessId: Number(env.VITE_LINE_OF_BUSINESS_ID || 1),
  jsonUrl: env.VITE_JSON_URL || 'data/savings-invoice.json',
  csvUrl: env.VITE_CSV_URL || 'data/savings-invoice.csv',
  customerName: env.VITE_CUSTOMER_NAME || 'Centene',
  appName: 'Payment Integrity Reporting',
};
