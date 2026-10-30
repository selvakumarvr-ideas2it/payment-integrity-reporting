import { describe, expect, it } from 'vitest';
import { parseCsvText } from './csv';
import { buildLocalReport, toMonthKey, toNumber } from './local-report';

describe('local file parsing', () => {
  it('reads currency and accounting negatives', () => {
    expect(toNumber('$9,747,642.83')).toBe(9747642.83);
    expect(toNumber('(1,000.50)')).toBe(-1000.5);
    expect(toNumber('')).toBe(0);
  });

  it('normalises month formats', () => {
    expect(toMonthKey('Sep-2026')).toBe('2026-09');
    expect(toMonthKey('2026-09-15')).toBe('2026-09');
    expect(toMonthKey('9/2026')).toBe('2026-09');
    expect(toMonthKey('9/15/2026')).toBe('2026-09');
    expect(toMonthKey('September 2026')).toBe('2026-09');
    expect(toMonthKey('garbage')).toBeNull();
  });
});

describe('CSV to report', () => {
  const csv = `Month of Transaction,Market,Program Type,Total # Claims Denied,Total Gross Savings,Amount
Sep-2026,NY,Medicaid,"1,000","$2,000.10",$1000.05
Sep-2026,FL,Medicaid,500,1000,500
Aug-2026,NY,Marketplace,200,300.5,100.25`;
  const rows = parseCsvText(csv);

  it('rolls up by month and computes KPIs', () => {
    const report = buildLocalReport({ rawRows: rows, filters: { market: [], programType: [] }, source: 'csv' });
    expect(report.rows.map((row) => row.month)).toEqual(['2026-09', '2026-08']);
    expect(report.rows[0]).toMatchObject({ claimsDenied: 1500, grossSavings: 3000.1, amount: 1500.05 });
    expect(report.kpis.find((kpi) => kpi.key === 'claimsDenied')?.value).toBe(1700);
    expect(report.filterOptions.market).toEqual(['FL', 'NY']);
  });

  it('applies market and program filters', () => {
    const report = buildLocalReport({
      rawRows: rows,
      filters: { market: ['NY'], programType: [] },
      source: 'csv',
    });
    expect(report.kpis.find((kpi) => kpi.key === 'claimsDenied')?.value).toBe(1200);
  });

  it('treats an empty list as all values', () => {
    const both = buildLocalReport({
      rawRows: rows,
      filters: { market: ['NY', 'FL'], programType: [] },
      source: 'upload',
    });
    expect(both.kpis.find((kpi) => kpi.key === 'claimsDenied')?.value).toBe(1700);
    const some = buildLocalReport({
      rawRows: rows,
      filters: { market: ['NY', 'FL'], programType: ['Medicaid'] },
      source: 'upload',
    });
    expect(some.kpis.find((kpi) => kpi.key === 'claimsDenied')?.value).toBe(1500);
  });
});
