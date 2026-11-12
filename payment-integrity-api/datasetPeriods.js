/** HPM dataset time periods. Keep in sync with payment-integrity-reporting/src/data/datasetPeriods.js */

const emptyRange = () => ({ start: '', end: '' });
const emptyBucket = () => ({ service: emptyRange(), payment: emptyRange(), enrollment: emptyRange() });

export function emptyPeriods() {
  return {
    current: emptyBucket(),
    prior: emptyBucket(),
    priorPrior: emptyBucket(),
    continuouslyEnrolled: emptyRange(),
    usePaidOnly: false,
    includeContinuouslyEnrolled: true,
    included: { current: true, prior: true, priorPrior: false },
    isNorm: false,
    isDefaultTemplate: false,
    popularSelection: '',
  };
}

export function addMonths(isoDate, months) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function yearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function fillBucket(year) {
  const range = yearRange(year);
  return { service: { ...range }, payment: { ...range }, enrollment: { ...range } };
}

/** Presets shown as Popular Selections on the Time Periods step. */
export const POPULAR_SELECTIONS = [
  { id: '2025-full', label: '2025 Full Year' },
  { id: '2024-full', label: '2024 Full Year' },
  { id: '2025-2026-sfy', label: '2025–2026 (Jul–Jun)' },
];

export function applyPopularSelection(id) {
  const periods = emptyPeriods();
  periods.popularSelection = id;
  if (id === '2025-full') {
    periods.current = fillBucket(2025);
    periods.prior = fillBucket(2024);
    periods.continuouslyEnrolled = { start: '2024-01-01', end: '2025-12-31' };
  } else if (id === '2024-full') {
    periods.current = fillBucket(2024);
    periods.prior = fillBucket(2023);
    periods.continuouslyEnrolled = { start: '2023-01-01', end: '2024-12-31' };
  } else if (id === '2025-2026-sfy') {
    const cur = { start: '2025-07-01', end: '2026-06-30' };
    const prior = { start: '2024-07-01', end: '2025-06-30' };
    periods.current = { service: { ...cur }, payment: { ...cur }, enrollment: { ...cur } };
    periods.prior = { service: { ...prior }, payment: { ...prior }, enrollment: { ...prior } };
    periods.continuouslyEnrolled = { start: '2024-07-01', end: '2026-06-30' };
  }
  return periods;
}

/** Payment window = service start through service end + 6 months (HPM "6 Month Runout"). */
export function applySixMonthRunout(bucket) {
  if (!bucket?.service?.start || !bucket?.service?.end) return bucket;
  return {
    ...bucket,
    payment: { start: bucket.service.start, end: addMonths(bucket.service.end, 6) },
  };
}

export function periodMonths(range) {
  if (!range?.start || !range?.end) return null;
  const [ys, ms] = range.start.slice(0, 7).split('-').map(Number);
  const [ye, me] = range.end.slice(0, 7).split('-').map(Number);
  const n = (ye - ys) * 12 + (me - ms) + 1;
  return n > 0 ? n : null;
}

/** HPM-style name: "2025-01 thru 2025-12, paid 2025-12". */
export function generateDatasetName(periods) {
  const s = periods?.current?.service?.start?.slice(0, 7);
  const e = periods?.current?.service?.end?.slice(0, 7);
  const paid = periods?.current?.payment?.end?.slice(0, 7);
  if (!s || !e) return '';
  return paid ? `${s} thru ${e}, paid ${paid}` : `${s} thru ${e}`;
}

export function monthRangeFromPeriods(periods) {
  const bucket = periods?.usePaidOnly ? periods?.current?.payment : periods?.current?.service;
  const start = bucket?.start?.slice(0, 7);
  const end = bucket?.end?.slice(0, 7);
  if (!start || !end) return null;
  return { start, end };
}

export function describePeriods(periods) {
  const r = monthRangeFromPeriods(periods);
  if (!r) return 'No time periods';
  const parts = [`Service ${r.start} – ${r.end}`];
  const paid = periods?.current?.payment?.end?.slice(0, 7);
  if (paid) parts.push(`paid through ${paid}`);
  if (periods?.included?.prior && periods.prior?.service?.start)
    parts.push(`prior ${periods.prior.service.start.slice(0, 7)} – ${periods.prior.service.end.slice(0, 7)}`);
  return parts.join(' · ');
}

export function monthFilterFromPeriods(periods) {
  const range = monthRangeFromPeriods(periods);
  if (!range) return null;
  return { attributeKey: 'month', operator: 'BETWEEN', values: [range.start, range.end] };
}
