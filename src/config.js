const env = import.meta.env;

export const config = {
  defaultSource: env.VITE_DATA_SOURCE || 'api',
  api: {
    // '/api' goes through the Vite dev/preview proxy to the local Function API (see vite.config.js).
    baseUrl: (env.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
    queryPath: env.VITE_API_QUERY_PATH || '/query',
    key: env.VITE_API_KEY || '',
    timeoutMs: Number(env.VITE_API_TIMEOUT_MS || 30000),
  },
  jsonUrl: env.VITE_JSON_URL || 'data/savings-invoice.json',
  csvUrl: env.VITE_CSV_URL || 'data/savings-invoice.csv',
  customerName: env.VITE_CUSTOMER_NAME || 'Centene',
  appName: 'Payment Integrity Reporting',
};
