import { describe, expect, it } from 'vitest';
import { buildReport, toMonthKey, toNumber, ALL } from './schema.js';
import { parseCsvText } from './csv.js';
import { buildApiRequest, financialImpactPath } from './dataService.js';
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
  it('matches the Azure financial-impact payload', () => {
    const req = buildApiRequest({
      filters: { market: ['NY', 'TX'], programType: [] },
      user: { id: 9, customerId: 1, customer: 'Centene' },
    });
    expect(req).toEqual({
      lineOfBusinessId: 1,
      userId: 9,
      measures: ['claimsDenied', 'grossSavings', 'amount'],
      aggregates: [{ attributeKey: 'month' }],
      filters: [{ attributeKey: 'market', values: ['NY', 'TX'] }],
      months: 24,
    });
    expect(req).not.toHaveProperty('customerId');
    expect(req).not.toHaveProperty('datasetId');
  });

  it('puts the client id on the financial-impact path and always sends page filters', () => {
    expect(financialImpactPath(1)).toBe('/api/v1/clients/1/financial-impact');
    expect(financialImpactPath(42)).toBe('/api/v1/clients/42/financial-impact');
    expect(buildApiRequest({ filters: { market: ['AZ'] }, user: { id: 1, customerId: 1 } })).toMatchObject({
      userId: 1,
      filters: [{ attributeKey: 'market', values: ['AZ'] }],
    });
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
