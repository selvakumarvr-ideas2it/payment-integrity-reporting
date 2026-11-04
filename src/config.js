const env = import.meta.env;

export const config = {
  defaultSource: env.VITE_DATA_SOURCE || 'api',
  api: {
    // App API (auth + datasets). '/api' is proxied to :7071 in vite.config.js.
    baseUrl: (env.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
    key: env.VITE_API_KEY || '',
    timeoutMs: Number(env.VITE_API_TIMEOUT_MS || 60000),
  },
  queryApi: {
    // External query API (Snowflake). In dev, Vite proxies /api/query to :7072.
    baseUrl: (env.VITE_QUERY_API_BASE_URL || env.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
    queryPath: env.VITE_API_QUERY_PATH || '/query',
    key: env.VITE_QUERY_API_KEY || env.VITE_API_KEY || '',
    timeoutMs: Number(env.VITE_API_TIMEOUT_MS || 60000),
  },
  lineOfBusinessId: Number(env.VITE_LINE_OF_BUSINESS_ID || 1),
  jsonUrl: env.VITE_JSON_URL || 'data/savings-invoice.json',
  csvUrl: env.VITE_CSV_URL || 'data/savings-invoice.csv',
  customerName: env.VITE_CUSTOMER_NAME || 'Centene',
  appName: 'Payment Integrity Reporting',
};
