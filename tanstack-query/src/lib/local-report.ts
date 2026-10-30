import { MEASURES, type MeasureKey, type ReportRow, type SavingsInvoiceResponse } from '@/model';
import type { FilterState } from '@/lib/filters';

export type LocalSource = 'json' | 'csv' | 'upload';

export type LocalReport = {
  report: { title: string; note?: string };
  kpis: SavingsInvoiceResponse['kpis'];
  rows: ReportRow[];
  filterOptions: { market: string[]; programType: string[] };
  source: LocalSource;
};

const FIELD_ALIASES: Record<string, string[]> = {
  month: ['month', 'monthoftransaction', 'transactionmonth', 'transdate', 'monthyear', 'period'],
  market: ['market', 'state', 'marketname'],
  programType: ['programtype', 'program', 'lob', 'lineofbusiness'],
  claimsDenied: ['claimsdenied', 'totalclaimsdenied', 'totalofclaimsdenied', 'claimcount', 'deniedclaims'],
  grossSavings: ['grosssavings', 'totalgrosssavings'],
  amount: ['amount', 'netamount', 'invoiceamount', 'savingsamount'],
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const squash = (value: string) => value.toLowerCase().replace(/[\s_\-#.]/g, '');

const aliasLookup = Object.entries(FIELD_ALIASES).reduce<Record<string, string>>((acc, [field, names]) => {
  names.forEach((name) => {
    acc[name] = field;
  });
  return acc;
}, {});

export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value).trim();
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[$,\s()]/g, '');
  const number = Number(text);
  if (!Number.isFinite(number)) return 0;
  return negative ? -number : number;
}

/** Accepts 2026-09, 2026-09-15, 09/2026, 9/15/2026, Sep-2026, Sep 2026, September 2026. */
export function toMonthKey(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/);
  if (match) return `${match[2]}-${match[1].padStart(2, '0')}`;
  match = text.match(/^([A-Za-z]{3,9})[\s\-/,]+(\d{4})$/);
  if (match) {
    const index = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
    if (index >= 0) return `${match[2]}-${String(index + 1).padStart(2, '0')}`;
  }
  return null;
}

type DetailRow = ReportRow & { market?: string; programType?: string };

export function normalizeRow(raw: Record<string, unknown>): DetailRow | null {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = aliasLookup[squash(key)];
    if (field) mapped[field] = value;
  }
  const month = toMonthKey(mapped.month);
  if (!month) return null;
  const row: DetailRow = {
    month,
    claimsDenied: toNumber(mapped.claimsDenied),
    grossSavings: toNumber(mapped.grossSavings),
    amount: toNumber(mapped.amount),
  };
  if (mapped.market !== undefined && String(mapped.market).trim() !== '') row.market = String(mapped.market).trim();
  if (mapped.programType !== undefined && String(mapped.programType).trim() !== '') row.programType = String(mapped.programType).trim();
  return row;
}

function selected(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => value && value !== '(All)');
}

export function filterRows(rows: DetailRow[], filters: FilterState): DetailRow[] {
  const market = selected(filters.market);
  const programType = selected(filters.programType);
  return rows.filter((row) => (!market.length || (row.market !== undefined && market.includes(row.market))) && (!programType.length || (row.programType !== undefined && programType.includes(row.programType))));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function aggregateByMonth(rows: DetailRow[]): ReportRow[] {
  const byMonth = new Map<string, ReportRow>();
  for (const row of rows) {
    const current = byMonth.get(row.month) ?? { month: row.month, claimsDenied: 0, grossSavings: 0, amount: 0 };
    current.claimsDenied = (current.claimsDenied ?? 0) + (row.claimsDenied ?? 0);
    current.grossSavings = (current.grossSavings ?? 0) + (row.grossSavings ?? 0);
    current.amount = (current.amount ?? 0) + (row.amount ?? 0);
    byMonth.set(row.month, current);
  }
  return [...byMonth.values()]
    .map((row) => ({
      month: row.month,
      claimsDenied: row.claimsDenied,
      grossSavings: round2(row.grossSavings ?? 0),
      amount: round2(row.amount ?? 0),
    }))
    .sort((left, right) => right.month.localeCompare(left.month));
}

function computeKpis(rows: ReportRow[]): SavingsInvoiceResponse['kpis'] {
  return (Object.keys(MEASURES) as MeasureKey[]).map((key) => ({
    key,
    label: MEASURES[key].label,
    format: MEASURES[key].format,
    value: round2(rows.reduce((sum, row) => sum + (row[key] || 0), 0)),
  }));
}

function normalizeKpis(kpis: unknown): SavingsInvoiceResponse['kpis'] | null {
  if (!kpis) return null;
  if (!Array.isArray(kpis)) {
    const record = kpis as Record<string, unknown>;
    return (Object.keys(MEASURES) as MeasureKey[])
      .filter((key) => record[key] !== undefined)
      .map((key) => ({
        key,
        label: MEASURES[key].label,
        format: MEASURES[key].format,
        value: toNumber(record[key]),
      }));
  }
  return kpis.map((item) => {
    const record = item as { key?: string; label?: string; format?: string; value?: unknown };
    const key = (record.key ?? '') as MeasureKey;
    const known = key in MEASURES ? MEASURES[key] : undefined;
    return {
      key,
      label: record.label || known?.label || record.key || '',
      format: record.format === 'currency' || known?.format === 'currency' ? 'currency' : 'number',
      value: toNumber(record.value),
    };
  });
}

const distinct = (rows: DetailRow[], field: 'market' | 'programType') =>
  [...new Set(rows.map((row) => row[field]).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));

/**
 * Turn JSON, CSV, or an uploaded file into the same month rows and KPIs the screen shows.
 * Filters run here. A saved dataset is not sent to the server for these sources.
 */
export function buildLocalReport({
  rawRows,
  kpis,
  filterOptions,
  report,
  filters,
  source,
}: {
  rawRows: Record<string, unknown>[];
  kpis?: unknown;
  filterOptions?: { market?: string[]; programType?: string[] };
  report?: { title?: string; note?: string };
  filters: FilterState;
  source: LocalSource;
}): LocalReport {
  const allRows = rawRows.map(normalizeRow).filter((row): row is DetailRow => row !== null);
  const scoped = filterRows(allRows, filters);
  const rows = aggregateByMonth(scoped);
  const filtered = selected(filters.market).length > 0 || selected(filters.programType).length > 0;
  const supplied = normalizeKpis(kpis);

  return {
    report: { title: report?.title || 'Savings Invoice', ...(report?.note ? { note: report.note } : {}) },
    kpis: supplied?.length && !filtered ? supplied : computeKpis(rows),
    rows,
    filterOptions: {
      market: filterOptions?.market?.length ? filterOptions.market : distinct(allRows, 'market'),
      programType: filterOptions?.programType?.length ? filterOptions.programType : distinct(allRows, 'programType'),
    },
    source,
  };
}
