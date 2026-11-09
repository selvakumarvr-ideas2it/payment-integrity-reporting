import { config } from '../config.js';
import { filterRows, normalizeRow } from './schema.js';
import { parseCsvText } from './csv.js';
import { fetchWithTimeout } from './apiClient.js';
import { queryFinancialImpact } from './dataService.js';

async function fetchOk(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res;
}

// Seeded random so the same month always gives the same rows.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const NOTES = ['APPEAL OR RECON CREDIT', 'GROSS SAVINGS', 'GROSS SAVINGS', 'GROSS SAVINGS'];
const ANALYTICS = ['UCM', 'P0335', 'P0336', 'C0937', 'C0931', 'RIDE ALONG'];

/** Split totalCents into weights-proportional parts that add up exactly. */
function split(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((totalCents * w) / sum));
  parts[parts.length - 1] += totalCents - parts.reduce((a, b) => a + b, 0);
  return parts;
}

function generateClaims(s) {
  const n = s.claimsDenied;
  if (!n) return [];
  const [year, mo] = s.month.split('-');
  const rand = mulberry32(hash(`${s.month}|${s.market || ''}|${s.programType || ''}`));
  const weights = Array.from({ length: n }, () => 0.5 + rand());
  const gross = split(Math.round(s.grossSavings * 100), weights);
  const amount = split(Math.round(s.amount * 100), weights);

  return Array.from({ length: n }, (_, i) => {
    const day = 1 + Math.floor(rand() * 28);
    const claimId = `Z${100 + Math.floor(rand() * 200)}${s.market || 'XX'}${pad(Math.floor(rand() * 100000), 5)}`;
    const svcMonth = 1 + Math.floor(rand() * 12);
    return {
      transactionDate: `${mo}/${pad(day)}/${year}`,
      note: NOTES[Math.floor(rand() * NOTES.length)],
      claimId,
      lineNumber: pad(1 + Math.floor(rand() * 5)),
      creditClaimId: rand() < 0.3 ? claimId : 'Null',
      market: s.market,
      productType: s.programType,
      lob: `${s.market || ''}GPMID`,
      lineServiceToDt: `${svcMonth}/${1 + Math.floor(rand() * 28)}/${year}`,
      originalAnalyticIdentifier: ANALYTICS[Math.floor(rand() * ANALYTICS.length)],
      grossSavings: gross[i] / 100,
      amount: amount[i] / 100,
    };
  });
}

export const DETAILS_AGGREGATES = [
  { attributeKey: 'month' },
  { attributeKey: 'market' },
  { attributeKey: 'programType' },
];

function summaryForMonth(raw, month, filters, applyFilters) {
  const normalized = (raw || []).map(normalizeRow).filter(Boolean);
  const scoped = applyFilters ? filterRows(normalized, filters) : normalized;
  const forMonth = scoped.filter((r) => r.month === month);
  const withMarket = forMonth.filter((r) => r.market);
  return withMarket.length ? withMarket : forMonth;
}

/** Claim-level rows for ONE month ('YYYY-MM'), scoped by Market and Program Type. */
export async function loadSavingsDetails({ month, source = config.defaultSource, filters, user, uploadedRows }) {
  if (uploadedRows) {
    const summary = summaryForMonth(uploadedRows, month, filters, true);
    return { month, rows: summary.flatMap(generateClaims) };
  }

  if (source === 'api') {
    const json = await queryFinancialImpact({
      filters,
      user,
      aggregates: DETAILS_AGGREGATES,
      extraFilters: month ? [{ attributeKey: 'month', values: [month] }] : [],
    });
    const summary = summaryForMonth(json.rows ?? json.data ?? [], month, filters, false);
    return { month, rows: summary.flatMap(generateClaims), filterOptions: json.filterOptions };
  }

  let raw;
  if (source === 'csv') {
    raw = parseCsvText(await (await fetchOk(config.csvUrl)).text());
  } else {
    const json = await (await fetchOk(config.jsonUrl)).json();
    raw = Array.isArray(json) ? json : json.rows ?? json.data ?? [];
  }
  const summary = summaryForMonth(raw, month, filters, true);
  return { month, rows: summary.flatMap(generateClaims) };
}
