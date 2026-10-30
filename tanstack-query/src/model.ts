/** Shared names for the Savings Invoice screen and the server allowlists. */

export const REPORT = {
  id: 'savings-invoice',
  title: 'Savings Invoice',
  category: 'Financial Dashboards',
  path: '/explore/savings-invoice',
  description:
    'Prepay savings over the last 24 months: claims denied, gross savings and invoice amount by month.',
} as const;

export const MEASURES = {
  claimsDenied: { label: 'Total # Claims Denied', format: 'number' },
  grossSavings: { label: 'Total Gross Savings', format: 'currency' },
  amount: { label: 'Amount', format: 'currency' },
} as const;

export type MeasureKey = keyof typeof MEASURES;

export const FILTER_ATTRIBUTES = {
  market: { label: 'Market' },
  programType: { label: 'Program Type' },
} as const;

export type FilterAttribute = keyof typeof FILTER_ATTRIBUTES;

export type FilterClause = {
  attributeKey: FilterAttribute;
  values: string[];
};

export type AppliedFilter = FilterClause & { source: 'dataset' | 'request' };

export const COLUMNS = [
  { field: 'month' as const, label: 'Month of Transaction', format: 'month' as const },
  { field: 'claimsDenied' as const, label: MEASURES.claimsDenied.label, format: MEASURES.claimsDenied.format },
  { field: 'grossSavings' as const, label: MEASURES.grossSavings.label, format: MEASURES.grossSavings.format },
  { field: 'amount' as const, label: MEASURES.amount.label, format: MEASURES.amount.format },
];

export const ALL = '(All)';

export const READ_POLICY = { PRIVATE: 1, PUBLIC: 2 } as const;
export const DATASET_STATUS_ACTIVE = 1;

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  customerId: number;
  customer: string;
};

export type DatasetRecord = {
  id: number;
  name: string;
  description: string;
  owner: { id: number; displayName: string };
  isOwner: boolean;
  isPublic: boolean;
  copiedFromId: number | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  filters: FilterClause[];
};

export type ReportRow = {
  month: string;
  claimsDenied?: number;
  grossSavings?: number;
  amount?: number;
};

export type SavingsInvoiceResponse = {
  report: {
    id: typeof REPORT.id;
    title: typeof REPORT.title;
    customer: string;
    asOf: string;
    from: string | null;
    to: string | null;
  };
  dataset: { id: number; name: string } | null;
  kpis: { key: MeasureKey; label: string; format: 'number' | 'currency'; value: number }[];
  filterOptions: { market: string[]; programType: string[] };
  appliedFilters: AppliedFilter[];
  rows: ReportRow[];
};
