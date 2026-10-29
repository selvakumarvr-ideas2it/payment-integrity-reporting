/**
 * The one shape every data source is turned into before the UI sees it.
 *
 * ReportData = {
 *   report:  { id, title, customer, asOf? },
 *   kpis:    [{ key, label, value, format }],          // format: 'number' | 'currency'
 *   columns: [{ field, label, format, align }],
 *   rows:    [{ month, market?, programType?, claimsDenied, grossSavings, amount }],
 *   filterOptions: { market: string[], programType: string[] },
 *   source:  'api' | 'json' | 'csv' | 'upload'
 * }
 *
 * `month` is always 'YYYY-MM'. Money values are plain numbers (no $ or commas).
 */

export const MEASURES = [
  { key: 'claimsDenied', label: 'Total # Claims Denied', format: 'number' },
  { key: 'grossSavings', label: 'Total Gross Savings', format: 'currency' },
  { key: 'amount', label: 'Amount', format: 'currency' },
];

export const COLUMNS = [
  { field: 'month', label: 'Month of Transaction', format: 'month', align: 'left' },
  ...MEASURES.map((m) => ({ field: m.key, label: m.label, format: m.format, align: 'right' })),
];

export const ALL = '(All)';

// Accepted header spellings for CSV / JSON rows (compared lower-case, without spaces, _ or -).
const FIELD_ALIASES = {
  month: ['month', 'monthoftransaction', 'transactionmonth', 'transdate', 'monthyear', 'period'],
  market: ['market', 'state', 'marketname'],
  programType: ['programtype', 'program', 'lob', 'lineofbusiness'],
  claimsDenied: ['claimsdenied', 'totalclaimsdenied', 'totalofclaimsdenied', 'claimcount', 'deniedclaims'],
  grossSavings: ['grosssavings', 'totalgrosssavings'],
  amount: ['amount', 'netamount', 'invoiceamount', 'savingsamount'],
};

const squash = (s) => String(s).toLowerCase().replace(/[\s_\-#.]/g, '');

const aliasLookup = Object.entries(FIELD_ALIASES).reduce((acc, [field, names]) => {
  names.forEach((n) => (acc[n] = field));
  return acc;
}, {});

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[$,\s()]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Accepts 2026-09, 2026-09-15, 09/2026, 9/15/2026, Sep-2026, Sep 2026, September 2026. Returns 'YYYY-MM' or null. */
export function toMonthKey(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]{3,9})[\s\-/,]+(\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  return null;
}

export function formatMonth(key) {
  const [y, mo] = key.split('-');
  const name = MONTHS[Number(mo) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}-${y}`;
}

/** Map one raw record (any header spelling) to a canonical row. Returns null if it has no usable month. */
export function normalizeRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = aliasLookup[squash(k)];
    if (field) out[field] = v;
  }
  const month = toMonthKey(out.month);
  if (!month) return null;
  const row = {
    month,
    claimsDenied: toNumber(out.claimsDenied),
    grossSavings: toNumber(out.grossSavings),
    amount: toNumber(out.amount),
  };
  if (out.market !== undefined && String(out.market).trim() !== '') row.market = String(out.market).trim();
  if (out.programType !== undefined && String(out.programType).trim() !== '')
    row.programType = String(out.programType).trim();
  return row;
}

const distinct = (rows, field) =>
  [...new Set(rows.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** A filter value as a list of selected values; [] means all. Accepts an array, a single value or ALL. */
export function toList(v) {
  if (Array.isArray(v)) return v.filter((x) => x && x !== ALL);
  return v && v !== ALL ? [v] : [];
}

export function filterRows(rows, filters = {}) {
  const market = toList(filters.market);
  const programType = toList(filters.programType);
  return rows.filter(
    (r) => (!market.length || market.includes(r.market)) && (!programType.length || programType.includes(r.programType)),
  );
}

/** Roll rows up to one row per month, newest first. */
export function aggregateByMonth(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const acc = byMonth.get(r.month) || { month: r.month, claimsDenied: 0, grossSavings: 0, amount: 0 };
    acc.claimsDenied += r.claimsDenied;
    acc.grossSavings += r.grossSavings;
    acc.amount += r.amount;
    byMonth.set(r.month, acc);
  }
  return [...byMonth.values()]
    .map((r) => ({ ...r, grossSavings: round2(r.grossSavings), amount: round2(r.amount) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

const round2 = (n) => Math.round(n * 100) / 100;

export function computeKpis(rows) {
  return MEASURES.map((m) => ({
    key: m.key,
    label: m.label,
    format: m.format,
    value: round2(rows.reduce((sum, r) => sum + (r[m.key] || 0), 0)),
  }));
}

/**
 * Build ReportData from raw rows (CSV, JSON or API).
 * - Local sources (csv/json/upload) are filtered here.
 * - API sources are assumed to be filtered server-side, so `applyFilters` is false.
 * - KPIs from the source are kept only when no local filter changed the rows.
 */
export function buildReport({ rawRows, kpis, filterOptions, report, filters, applyFilters, source }) {
  const allRows = (rawRows || []).map(normalizeRow).filter(Boolean);
  const scoped = applyFilters ? filterRows(allRows, filters) : allRows;
  const rows = aggregateByMonth(scoped);
  const filtered = applyFilters && filters && [filters.market, filters.programType].some((f) => toList(f).length);

  return {
    report: {
      id: 'savings-invoice',
      title: 'Savings Invoice',
      ...report,
    },
    kpis: kpis?.length && !filtered ? normalizeKpis(kpis) : computeKpis(rows),
    columns: COLUMNS,
    rows,
    filterOptions: {
      market: filterOptions?.market?.length ? filterOptions.market : distinct(allRows, 'market'),
      programType: filterOptions?.programType?.length
        ? filterOptions.programType
        : distinct(allRows, 'programType'),
    },
    source,
  };
}

function normalizeKpis(kpis) {
  // Accept either an array of {key,label,value} or an object {claimsDenied: 1, ...}
  if (!Array.isArray(kpis)) {
    return MEASURES.filter((m) => kpis[m.key] !== undefined).map((m) => ({
      ...m,
      value: toNumber(kpis[m.key]),
    }));
  }
  return kpis.map((k) => {
    const known = MEASURES.find((m) => m.key === k.key);
    return {
      key: k.key,
      label: k.label || known?.label || k.key,
      format: k.format || known?.format || 'number',
      value: toNumber(k.value),
    };
  });
}
