import { config } from '../config.js';
import { MEASURES, normalizeRow, toList } from './schema.js';
import { parseCsvText } from './csv.js';
import { apiFetch, fetchWithTimeout } from './apiClient.js';

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
  const rand = mulberry32(hash(`${s.month}|${s.market}|${s.programType}`));
  const weights = Array.from({ length: n }, () => 0.5 + rand());
  const gross = split(Math.round(s.grossSavings * 100), weights);
  const amount = split(Math.round(s.amount * 100), weights);

  return Array.from({ length: n }, (_, i) => {
    const day = 1 + Math.floor(rand() * 28);
    const claimId = `Z${100 + Math.floor(rand() * 200)}${s.market}${pad(Math.floor(rand() * 100000), 5)}`;
    const svcMonth = 1 + Math.floor(rand() * 12);
    return {
      transactionDate: `${mo}/${pad(day)}/${year}`,
      note: NOTES[Math.floor(rand() * NOTES.length)],
      claimId,
      lineNumber: pad(1 + Math.floor(rand() * 5)),
      creditClaimId: rand() < 0.3 ? claimId : 'Null',
      market: s.market,
      productType: s.programType,
      lob: `${s.market}GPMID`,
      lineServiceToDt: `${svcMonth}/${1 + Math.floor(rand() * 28)}/${year}`,
      originalAnalyticIdentifier: ANALYTICS[Math.floor(rand() * ANALYTICS.length)],
      grossSavings: gross[i] / 100,
      amount: amount[i] / 100,
    };
  });
}

/** Claim-level rows for ONE month ('YYYY-MM'), built from the same data page 1 uses. */
export async function loadSavingsDetails({ month, source, filters }) {
  if (source === 'api') {
    const apiFilters = [];
    for (const attributeKey of ['market', 'programType']) {
      const values = toList(filters?.[attributeKey]);
      if (values.length) apiFilters.push({ attributeKey, values });
    }

    const json = await apiFetch(config.api.queryPath, {
      method: 'POST',
      body: {
        reportId: 'savings-invoice',
        measures: MEASURES.map((m) => m.key),
        aggregates: [
          { attributeKey: 'month', grain: 'month' },
          { attributeKey: 'market' },
          { attributeKey: 'programType' },
        ],
        filters: apiFilters,
        months: 24,
      },
    });

    const summary = (json.rows ?? json.data ?? [])
      .map(normalizeRow)
      .filter((r) => r && r.month === month && r.market);
    return { month, rows: summary.flatMap(generateClaims) };
  }

  let raw;
  if (source === 'csv') {
    raw = parseCsvText(await (await fetchOk(config.csvUrl)).text());
  } else {
    const json = await (await fetchOk(config.jsonUrl)).json();
    raw = Array.isArray(json) ? json : json.rows ?? json.data ?? [];
  }
  const summary = raw.map(normalizeRow).filter((r) => r && r.month === month && r.market);
  return { month, rows: summary.flatMap(generateClaims) };
}
