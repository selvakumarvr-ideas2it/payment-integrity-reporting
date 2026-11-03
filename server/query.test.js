import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors.js';
import {
  buildSnowflakePayloads,
  engineError,
  kpiFormat,
  mapSnowflakeToReport,
  createSnowflakeExecuteQuery,
} from './query.js';
import { parseCallResult } from './db/snowflake.js';

const user = { id: 9, customerId: 1, customer: 'Centene' };
const dataset = {
  id: 7,
  name: 'Arizona-CPI',
  filters: [{ attributeKey: 'market', values: ['AZ'] }],
};

describe('Snowflake result parsing', () => {
  it('reads the procedure VARIANT from the first column, whether it is an object or JSON text', () => {
    expect(parseCallResult([{ EXECUTE_QUERY: { status: 'OK' } }])).toEqual({ status: 'OK' });
    expect(parseCallResult([{ EXECUTE_QUERY: '{"status":"OK"}' }])).toEqual({ status: 'OK' });
  });
});

describe('Snowflake payload', () => {
  it('takes customerId from the user and drops browser customerId / debug', () => {
    const { grid, kpis } = buildSnowflakePayloads(
      user,
      {
        customerId: 99,
        lineOfBusinessId: 99,
        debug: true,
        measures: ['claimsDenied', 'grossSavings', 'amount'],
        aggregates: [{ attributeKey: 'month', grain: 'month' }],
        filters: [{ attributeKey: 'market', values: ['TX'] }],
        months: 12,
      },
      { dataset: null, lineOfBusinessId: 1 },
    );
    expect(grid.customerId).toBe(1);
    expect(grid.lineOfBusinessId).toBe(1);
    expect(grid.debug).toBeUndefined();
    expect(grid.filters).toEqual([{ attributeKey: 'market', values: ['TX'] }]);
    expect(grid.attributeValues).toEqual(['market', 'programType']);
    expect(grid.aggregates[0].attributeKey).toBe('month');
    expect(kpis.aggregates).toBeUndefined();
    expect(kpis.months).toBe(12);
  });

  it('puts dataset filters in front of request filters and defaults measures to the Savings Invoice set', () => {
    const { grid } = buildSnowflakePayloads(user, { datasetId: 7, filters: [{ attributeKey: 'programType', values: ['CPI'] }] }, { dataset, lineOfBusinessId: 1 });
    expect(grid.datasetId).toBe(7);
    expect(grid.measures).toEqual(['claimsDenied', 'grossSavings', 'amount']);
    expect(grid.filters).toEqual([
      { attributeKey: 'market', values: ['AZ'] },
      { attributeKey: 'programType', values: ['CPI'] },
    ]);
  });
});

describe('Snowflake response mapping', () => {
  it('maps FORMATSTRING containing $ to currency and builds the React report shape', () => {
    expect(kpiFormat('$#,##0.00')).toBe('currency');
    expect(kpiFormat('#,##0')).toBe('number');

    const grid = {
      status: 'OK',
      rows: [
        { month: '2026-09', claimsDenied: 10, grossSavings: 20, amount: 5 },
        { month: '2026-08', claimsDenied: 4, grossSavings: 8, amount: 2 },
      ],
      appliedFilters: [{ attributeKey: 'market', values: ['AZ'], source: 'dataset' }],
      attributeValues: { market: ['AZ', 'TX'], programType: ['CPI', 'EDC'] },
    };
    const kpis = {
      columns: [
        { name: 'claimsDenied', kind: 'measure', description: 'Total # Claims Denied', format: '#,##0' },
        { name: 'grossSavings', kind: 'measure', description: 'Total Gross Savings', format: '$#,##0.00' },
      ],
      rows: [{ claimsDenied: 14, grossSavings: 28 }],
    };
    const out = mapSnowflakeToReport({
      grid,
      kpis,
      user,
      dataset,
      report: { id: 'savings-invoice', title: 'Savings Invoice' },
    });
    expect(out.report).toMatchObject({ id: 'savings-invoice', customer: 'Centene', from: '2026-08', to: '2026-09' });
    expect(out.dataset).toEqual({ id: 7, name: 'Arizona-CPI' });
    expect(out.kpis).toEqual([
      { key: 'claimsDenied', label: 'Total # Claims Denied', format: 'number', value: 14 },
      { key: 'grossSavings', label: 'Total Gross Savings', format: 'currency', value: 28 },
    ]);
    expect(out.filterOptions.market).toEqual(['AZ', 'TX']);
    expect(out.rows).toHaveLength(2);
  });

  it('maps engine codes onto HTTP statuses and hides INTERNAL details', () => {
    expect(engineError({ status: 'OK' })).toBeNull();
    const bad = engineError({ status: 'ERROR', code: 'INVALID_REQUEST', message: 'Unknown measure', field: 'measures[0]' });
    expect(bad).toBeInstanceOf(ApiError);
    expect(bad).toMatchObject({ status: 400, message: 'Unknown measure', field: 'measures[0]' });
    expect(engineError({ status: 'ERROR', code: 'INTERNAL', message: 'SQL compilation error: boom' }).message).toBe(
      'Internal server error',
    );
  });
});

describe('Snowflake executeQuery adapter', () => {
  it('calls the engine twice, never forwards debug, and returns the mapped report', async () => {
    const calls = [];
    const callExecuteQuery = async (payload) => {
      calls.push(payload);
      if (payload.aggregates) {
        return {
          status: 'OK',
          rows: [{ month: '2026-09', claimsDenied: 8 }],
          columns: [],
          attributeValues: { market: ['AK'], programType: ['CPI'] },
          appliedFilters: [],
        };
      }
      return {
        status: 'OK',
        columns: [{ name: 'claimsDenied', kind: 'measure', description: 'Total # Claims Denied', format: '#,##0' }],
        rows: [{ claimsDenied: 8 }],
      };
    };
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('FROM pi.report')) return { rows: [{ report_id: 'savings-invoice', title: 'Savings Invoice' }] };
        return { rows: [] };
      }),
    };
    const executeQuery = createSnowflakeExecuteQuery({ pool, callExecuteQuery, lineOfBusinessId: 1 });
    const result = await executeQuery(user, { reportId: 'savings-invoice', debug: true, customerId: 99, months: 24 });
    expect(calls).toHaveLength(2);
    expect(calls.every((p) => p.customerId === 1 && p.debug === undefined)).toBe(true);
    expect(result.kpis[0].value).toBe(8);
    expect(result.filterOptions.market).toEqual(['AK']);
  });

  it('turns an engine INVALID_REQUEST into a 400 ApiError', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ report_id: 'savings-invoice', title: 'Savings Invoice' }] })) };
    const executeQuery = createSnowflakeExecuteQuery({
      pool,
      callExecuteQuery: async () => ({ status: 'ERROR', code: 'INVALID_REQUEST', message: "Unknown measure 'nope'", field: 'measures[0]' }),
      lineOfBusinessId: 1,
    });
    await expect(executeQuery(user, { measures: ['nope'] })).rejects.toMatchObject({
      status: 400,
      field: 'measures[0]',
      message: "Unknown measure 'nope'",
    });
  });
});
