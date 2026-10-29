// Writes synthetic Savings Invoice data to public/data/savings-invoice.{json,csv} (no dependencies; Node 24).
//   node scripts/generate-sample-data.mjs [seed]
// One row per month x market x program type for the 24 months ending END_MONTH.
// Output is deterministic for a given seed. All figures are made up.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'data');

const SEED = Number(process.argv[2] || 20261028);
const END_MONTH = '2026-09';
const MONTHS = 24;

// Relative claim volume per market: all 50 US states, weighted roughly by population (millions).
const MARKETS = {
  AL: 5.1, AK: 0.7, AZ: 7.4, AR: 3.1, CA: 39.0, CO: 5.9, CT: 3.6, DE: 1.0, FL: 22.6, GA: 11.0,
  HI: 1.4, ID: 2.0, IL: 12.5, IN: 6.9, IA: 3.2, KS: 2.9, KY: 4.5, LA: 4.6, ME: 1.4, MD: 6.2,
  MA: 7.0, MI: 10.0, MN: 5.7, MS: 2.9, MO: 6.2, MT: 1.1, NE: 2.0, NV: 3.2, NH: 1.4, NJ: 9.3,
  NM: 2.1, NY: 19.6, NC: 10.8, ND: 0.8, OH: 11.8, OK: 4.1, OR: 4.2, PA: 13.0, RI: 1.1, SC: 5.4,
  SD: 0.9, TN: 7.1, TX: 30.5, UT: 3.4, VT: 0.6, VA: 8.7, WA: 7.8, WV: 1.8, WI: 5.9, WY: 0.6,
};

// Share of claim volume, average gross savings per denied claim, and invoice (fee) rate per program.
const PROGRAMS = {
  EDC: { share: 0.6, perClaim: 1100, feeRate: 0.58 },
  CPI: { share: 0.4, perClaim: 1450, feeRate: 0.55 },
};

// Month-of-year multiplier (Jan..Dec): lighter in Q1/December, heavier late summer.
const SEASON = [0.92, 0.88, 0.95, 0.97, 1.0, 1.02, 1.04, 1.06, 1.08, 1.05, 0.98, 0.94];

// Network-wide claims denied per month at the start of the window, and monthly growth.
const BASE_CLAIMS = 3400;
const GROWTH = 0.035;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const jitter = (spread) => 1 + (rand() * 2 - 1) * spread;
const round2 = (n) => Math.round(n * 100) / 100;

function monthKeys(end, count) {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

const marketWeight = Object.values(MARKETS).reduce((s, w) => s + w, 0);
const rows = [];

monthKeys(END_MONTH, MONTHS).forEach((month, i) => {
  const season = SEASON[Number(month.slice(5)) - 1];
  const monthClaims = BASE_CLAIMS * (1 + GROWTH) ** i * season * jitter(0.06);
  for (const [market, mw] of Object.entries(MARKETS)) {
    for (const [programType, p] of Object.entries(PROGRAMS)) {
      const claimsDenied = Math.max(1, Math.round((monthClaims * mw * p.share * jitter(0.15)) / marketWeight));
      const grossSavings = round2(claimsDenied * p.perClaim * jitter(0.12));
      const amount = round2(grossSavings * p.feeRate * jitter(0.05));
      rows.push({ month, market, programType, claimsDenied, grossSavings, amount });
    }
  }
});

rows.sort(
  (a, b) =>
    b.month.localeCompare(a.month) || a.market.localeCompare(b.market) || a.programType.localeCompare(b.programType),
);

const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
const distinct = (k) => [...new Set(rows.map((r) => r[k]))].sort((a, b) => a.localeCompare(b));

const json = {
  report: {
    id: 'savings-invoice',
    title: 'Savings Invoice',
    customer: 'Centene',
    note: `Synthetic data from scripts/generate-sample-data.mjs (seed ${SEED}): ${MONTHS} months x ${Object.keys(MARKETS).length} markets x ${Object.keys(PROGRAMS).length} program types. Not real figures.`,
  },
  kpis: [
    { key: 'claimsDenied', label: 'Total # Claims Denied', format: 'number', value: sum('claimsDenied') },
    { key: 'grossSavings', label: 'Total Gross Savings', format: 'currency', value: sum('grossSavings') },
    { key: 'amount', label: 'Amount', format: 'currency', value: sum('amount') },
  ],
  filterOptions: { market: distinct('market'), programType: distinct('programType') },
  rows,
};

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = [
  'month,market,program_type,claims_denied,gross_savings,amount',
  ...rows.map((r) =>
    [r.month, r.market, r.programType, r.claimsDenied, r.grossSavings.toFixed(2), r.amount.toFixed(2)]
      .map(csvCell)
      .join(','),
  ),
].join('\n');

await writeFile(join(OUT, 'savings-invoice.json'), JSON.stringify(json, null, 2) + '\n');
await writeFile(join(OUT, 'savings-invoice.csv'), csv + '\n');

console.log(`Wrote ${rows.length} rows (${MONTHS} months) to public/data/`);
for (const k of json.kpis) console.log(`  ${k.label}: ${k.value.toLocaleString('en-US')}`);
