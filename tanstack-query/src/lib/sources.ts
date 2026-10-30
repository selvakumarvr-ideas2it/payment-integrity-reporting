export const SOURCES = {
  api: 'Function API',
  json: 'JSON file',
  csv: 'CSV file',
} as const;

export type DataSource = keyof typeof SOURCES;

export const JSON_URL = '/data/savings-invoice.json';
export const CSV_URL = '/data/savings-invoice.csv';
