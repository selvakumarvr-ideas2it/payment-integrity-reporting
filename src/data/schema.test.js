import { describe, expect, it } from 'vitest';
import { buildReport, toMonthKey, toNumber, ALL } from './schema.js';
import { parseCsvText } from './csv.js';
import { buildApiRequest } from './dataService.js';
import { fromFilterList, sameFilters, toFilterList } from './datasetsApi.js';

describe('parsing helpers', () => {
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
    const r = buildReport({ rawRows: rows, filters: {}, applyFilters: true, source: 'csv' });
    expect(r.rows.map((x) => x.month)).toEqual(['2026-09', '2026-08']);
    expect(r.rows[0]).toMatchObject({ claimsDenied: 1500, grossSavings: 3000.1, amount: 1500.05 });
    expect(r.kpis.find((k) => k.key === 'claimsDenied').value).toBe(1700);
    expect(r.filterOptions.market).toEqual(['FL', 'NY']);
  });

  it('applies market and program filters', () => {
    const r = buildReport({ rawRows: rows, filters: { market: 'NY', programType: ALL }, applyFilters: true, source: 'csv' });
    expect(r.kpis.find((k) => k.key === 'claimsDenied').value).toBe(1200);
  });

  it('applies multi-select filters; an empty list means all', () => {
    const both = buildReport({ rawRows: rows, filters: { market: ['NY', 'FL'], programType: [] }, applyFilters: true, source: 'csv' });
    expect(both.kpis.find((k) => k.key === 'claimsDenied').value).toBe(1700);
    const some = buildReport({ rawRows: rows, filters: { market: ['NY', 'FL'], programType: ['Medicaid'] }, applyFilters: true, source: 'csv' });
    expect(some.kpis.find((k) => k.key === 'claimsDenied').value).toBe(1500);
  });
});

describe('API request', () => {
  it('uses the executeQuery-style measures / filters / aggregates shape', () => {
    const req = buildApiRequest({ filters: { market: ['NY', 'TX'], programType: [] } });
    expect(req.measures).toEqual(['claimsDenied', 'grossSavings', 'amount']);
    expect(req.filters).toEqual([{ attributeKey: 'market', values: ['NY', 'TX'] }]);
    expect(req.aggregates[0].attributeKey).toBe('month');
    expect(req).not.toHaveProperty('datasetId');
  });

  it('sends a saved dataset by id', () => {
    expect(buildApiRequest({ filters: { market: ALL }, datasetId: 7 })).toMatchObject({ datasetId: 7, filters: [] });
  });
});

describe('dataset filters', () => {
  it('converts between page filters and the API list, ignoring order', () => {
    const list = toFilterList({ market: ['TX', 'AZ'], programType: [] });
    expect(list).toEqual([{ attributeKey: 'market', values: ['AZ', 'TX'] }]);
    expect(fromFilterList(list)).toEqual({ market: ['AZ', 'TX'], programType: [] });
    expect(sameFilters({ market: ['TX', 'AZ'], programType: [] }, { market: ['AZ', 'TX'] })).toBe(true);
    expect(sameFilters({ market: ['AZ'] }, { market: ['AZ'], programType: ['CPI'] })).toBe(false);
  });
});
