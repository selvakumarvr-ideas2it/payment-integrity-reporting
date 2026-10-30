/** Synthetic Savings Invoice facts. Fixed seed so every load is the same. Not real figures. */

const SEED = 20261028;
const END_MONTH = '2026-09';
const MONTHS = 24;

const MARKETS: Record<string, number> = {
  AL: 5.1, AK: 0.7, AZ: 7.4, AR: 3.1, CA: 39.0, CO: 5.9, CT: 3.6, DE: 1.0, FL: 22.6, GA: 11.0,
  HI: 1.4, ID: 2.0, IL: 12.5, IN: 6.9, IA: 3.2, KS: 2.9, KY: 4.5, LA: 4.6, ME: 1.4, MD: 6.2,
  MA: 7.0, MI: 10.0, MN: 5.7, MS: 2.9, MO: 6.2, MT: 1.1, NE: 2.0, NV: 3.2, NH: 1.4, NJ: 9.3,
  NM: 2.1, NY: 19.6, NC: 10.8, ND: 0.8, OH: 11.8, OK: 4.1, OR: 4.2, PA: 13.0, RI: 1.1, SC: 5.4,
  SD: 0.9, TN: 7.1, TX: 30.5, UT: 3.4, VT: 0.6, VA: 8.7, WA: 7.8, WV: 1.8, WI: 5.9, WY: 0.6,
};

const PROGRAMS: Record<string, { share: number; perClaim: number; feeRate: number }> = {
  EDC: { share: 0.6, perClaim: 1100, feeRate: 0.58 },
  CPI: { share: 0.4, perClaim: 1450, feeRate: 0.55 },
};

const SEASON = [0.92, 0.88, 0.95, 0.97, 1.0, 1.02, 1.04, 1.06, 1.08, 1.05, 0.98, 0.94];
const BASE_CLAIMS = 3400;
const GROWTH = 0.035;

export type FactRow = {
  month: string;
  market: string;
  programType: string;
  claimsDenied: number;
  grossSavings: string;
  amount: string;
};

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function monthKeys(end: string, count: number): string[] {
  const [year, month] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function syntheticFacts(): FactRow[] {
  const rand = mulberry32(SEED);
  const jitter = (spread: number) => 1 + (rand() * 2 - 1) * spread;
  const marketWeight = Object.values(MARKETS).reduce((sum, weight) => sum + weight, 0);
  const rows: FactRow[] = [];

  monthKeys(END_MONTH, MONTHS).forEach((month, index) => {
    const season = SEASON[Number(month.slice(5)) - 1];
    const monthClaims = BASE_CLAIMS * (1 + GROWTH) ** index * season * jitter(0.06);
    for (const [market, weight] of Object.entries(MARKETS)) {
      for (const [programType, program] of Object.entries(PROGRAMS)) {
        const claimsDenied = Math.max(1, Math.round((monthClaims * weight * program.share * jitter(0.15)) / marketWeight));
        const grossSavings = round2(claimsDenied * program.perClaim * jitter(0.12));
        const amount = round2(grossSavings * program.feeRate * jitter(0.05));
        rows.push({
          month,
          market,
          programType,
          claimsDenied,
          grossSavings: grossSavings.toFixed(2),
          amount: amount.toFixed(2),
        });
      }
    }
  });

  return rows;
}

export const SYNTHETIC_SEED = SEED;
export const SYNTHETIC_ROW_COUNT = MONTHS * Object.keys(MARKETS).length * Object.keys(PROGRAMS).length;
