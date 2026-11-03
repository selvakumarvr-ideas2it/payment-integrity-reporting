// Runs the real JavaScript body of snowflake/03_execute_query.sql against a fake Snowflake driver.
// It checks the SQL the procedure generates and its validation, not Snowflake itself: the generated SQL still has to
// be run once in a real account (snowflake/06_smoke_test.sql).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./03_execute_query.sql', import.meta.url)), 'utf8');
const body = /\bAS\s*\r?\n\$\$\r?\n([\s\S]*?)\r?\n\$\$;/.exec(source)?.[1];

const MEASURES = [
  { MEASUREID: 1, MEASURE: 'claimsDenied', MEASUREDESCRIPTION: 'Total # Claims Denied', MEASUREFACT: 'FACT_SAVINGS', SQLCALCSTATEMENT: 'SUM(F.CLAIMS_DENIED)', FORMATSTRING: '#,##0', BASENUMERATOR: null, BASEDENOMINATOR: null, RESULTMULTIPLIER: null, OPERATOR: null, USESABSOLUTE: 0 },
  { MEASUREID: 2, MEASURE: 'grossSavings', MEASUREDESCRIPTION: 'Total Gross Savings', MEASUREFACT: 'FACT_SAVINGS', SQLCALCSTATEMENT: 'SUM(F.GROSS_SAVINGS)', FORMATSTRING: '$#,##0.00', BASENUMERATOR: null, BASEDENOMINATOR: null, RESULTMULTIPLIER: null, OPERATOR: null, USESABSOLUTE: 0 },
  { MEASUREID: 3, MEASURE: 'amount', MEASUREDESCRIPTION: 'Amount', MEASUREFACT: 'FACT_SAVINGS', SQLCALCSTATEMENT: 'SUM(F.AMOUNT)', FORMATSTRING: '$#,##0.00', BASENUMERATOR: null, BASEDENOMINATOR: null, RESULTMULTIPLIER: null, OPERATOR: null, USESABSOLUTE: 0 },
  { MEASUREID: 4, MEASURE: 'savingsPerClaim', MEASUREDESCRIPTION: 'Per claim', MEASUREFACT: null, SQLCALCSTATEMENT: null, FORMATSTRING: '$#,##0.00', BASENUMERATOR: 2, BASEDENOMINATOR: 1, RESULTMULTIPLIER: '100', OPERATOR: '/', USESABSOLUTE: 0 },
  { MEASUREID: 5, MEASURE: 'evil', MEASUREDESCRIPTION: null, MEASUREFACT: 'FACT_SAVINGS', SQLCALCSTATEMENT: 'SUM(F.AMOUNT); DROP TABLE X', FORMATSTRING: null, BASENUMERATOR: null, BASEDENOMINATOR: null, RESULTMULTIPLIER: null, OPERATOR: null, USESABSOLUTE: 0 },
  { MEASUREID: 6, MEASURE: 'cpiClaims', MEASUREDESCRIPTION: null, MEASUREFACT: 'FACT_SAVINGS', SQLCALCSTATEMENT: 'SUM(F.CLAIMS_DENIED)', FORMATSTRING: null, BASENUMERATOR: null, BASEDENOMINATOR: null, RESULTMULTIPLIER: null, OPERATOR: null, USESABSOLUTE: 0 },
];
const ATTRIBUTES = [
  { ATTRIBUTEID: 1, ATTRIBUTEKEY: 'month', ATTRIBUTEDESCRIPTION: 'Month of Transaction', FILTERSQL: 'F.MONTH' },
  { ATTRIBUTEID: 2, ATTRIBUTEKEY: 'market', ATTRIBUTEDESCRIPTION: 'Market', FILTERSQL: 'F.MARKET' },
  { ATTRIBUTEID: 3, ATTRIBUTEKEY: 'programType', ATTRIBUTEDESCRIPTION: 'Program Type', FILTERSQL: 'F.PROGRAM_TYPE' },
];
const RELATIONSHIPS = [
  { RELATIONSHIPMETADATAID: 1, ATTRIBUTEKEY: 'month', FACTTABLE: 'FACT_SAVINGS', SQLCOLUMN: 'MONTH', SQLJOINSTATEMENT: null, ISYEARMONTH: 'Y' },
  { RELATIONSHIPMETADATAID: 2, ATTRIBUTEKEY: 'market', FACTTABLE: 'FACT_SAVINGS', SQLCOLUMN: 'MARKET', SQLJOINSTATEMENT: null, ISYEARMONTH: 'N' },
  { RELATIONSHIPMETADATAID: 3, ATTRIBUTEKEY: 'programType', FACTTABLE: 'FACT_SAVINGS', SQLCOLUMN: 'PROGRAM_TYPE', SQLJOINSTATEMENT: null, ISYEARMONTH: 'N' },
];

function resultSet(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  let i = -1;
  return {
    getColumnCount: () => cols.length,
    getColumnName: (n) => cols[n - 1],
    next: () => ++i < rows.length,
    getColumnValue: (n) => rows[i][cols[n - 1]],
  };
}

/** Fake `snowflake` object. `opts` can override the cache, the measure filters or make the final query fail. */
function fakeSnowflake(opts = {}) {
  const calls = [];
  const state = { calls, finalSql: null };
  const data = {
    measures: opts.measures ?? MEASURES,
    mfilters: opts.mfilters ?? [],
    cache: opts.cache ?? null,
  };
  state.snowflake = {
    execute({ sqlText, binds = [] }) {
      calls.push({ sqlText, binds });
      const s = sqlText;
      if (s.includes('HASH(?)')) return resultSet([{ H: '-1234567890123456789' }]);
      if (s.includes('FROM PI.BI_ENGINE.EXECUTE_QUERY_CACHE')) return resultSet(data.cache ? [data.cache] : []);
      if (s.includes('FROM PI.BI_ENGINE.MEASURE_DETAILS')) return resultSet(data.measures);
      if (s.includes('FROM PI.BI_ENGINE.MEASURE_FILTER_DETAILS')) return resultSet(data.mfilters);
      if (s.includes('FROM PI.BI_ENGINE.ATTRIBUTE_DETAILS')) {
        const keys = binds.slice(1);
        return resultSet(ATTRIBUTES.filter((a) => keys.includes(a.ATTRIBUTEKEY.toUpperCase())));
      }
      if (s.includes('FROM PI.BI_ENGINE.RELATIONSHIP_METADATA_DETAILS')) {
        if (s.includes('ISYEARMONTH) IN')) return resultSet(RELATIONSHIPS.filter((r) => r.ISYEARMONTH === 'Y'));
        return resultSet(RELATIONSHIPS.filter((r) => binds.includes(r.ATTRIBUTEKEY.toUpperCase())));
      }
      if (/^\s*(INSERT|MERGE|UPDATE)/.test(s)) return resultSet([]);
      if (s.startsWith('SELECT DISTINCT')) return resultSet([{ V: 'AZ' }, { V: 'TX' }]);
      // anything else is the generated report SQL
      state.finalSql = s;
      if (opts.failFinal) throw new Error('SQL compilation error: boom');
      return resultSet([{ month: '2026-09', claimsDenied: 44 }]);
    },
  };
  return state;
}

function call(payload, { snowflakeState = fakeSnowflake(), useCache = true, sqlOnly = false } = {}) {
  expect(body, 'procedure body not found in 03_execute_query.sql').toBeTruthy();
  const fn = new Function('PAYLOAD', 'USER_ID', 'CLIENT_IP', 'USE_CACHE', 'SQL_ONLY', 'snowflake', body);
  const result = fn(payload, 'u1', '10.0.0.1', useCache, sqlOnly, snowflakeState.snowflake);
  return { result, ...snowflakeState };
}

const base = { customerId: 1, lineOfBusinessId: 1, measures: ['claimsDenied', 'grossSavings', 'amount'], aggregates: [{ attributeKey: 'month', grain: 'month' }] };
const inserts = (calls, table) => calls.filter((c) => c.sqlText.includes(table) && /^\s*INSERT/.test(c.sqlText));

describe('BI_ENGINE.EXECUTE_QUERY: SQL generation', () => {
  it('builds one CTE per base measure and merges them on the group-by keys', () => {
    const { result, finalSql } = call({ ...base, filters: [{ attributeKey: 'market', values: ['AZ', 'TX'] }], months: 24 });
    expect(result.status).toBe('OK');
    expect(finalSql).toContain('c1 AS (SELECT F.MONTH AS g0, SUM(F.CLAIMS_DENIED) AS V FROM PI.CORE.FACT_SAVINGS AS F');
    expect(finalSql).toContain('WHERE F.CUSTOMER_ID = 1 AND F.MARKET IN (\'AZ\', \'TX\')');
    expect(finalSql).toContain('F.MONTH >= (SELECT TO_CHAR(DATEADD(month, -23, TO_DATE(MAX(F.MONTH)');
    expect(finalSql).toContain('GROUP BY 1');
    expect(finalSql).toContain('FULL OUTER JOIN c2 ON EQUAL_NULL(c1.g0, c2.g0)');
    expect(finalSql).toContain('FULL OUTER JOIN c3 ON EQUAL_NULL(COALESCE(c1.g0, c2.g0), c3.g0)');
    expect(finalSql).toContain('COALESCE(c1.g0, c2.g0, c3.g0) AS "month"');
    expect(finalSql).toContain('c1.V AS "claimsDenied"');
    expect(finalSql).toContain('ORDER BY 1 DESC LIMIT 10000');
  });

  it('returns column descriptors and applied filters for the Function API', () => {
    const { result } = call({ ...base, filters: [{ attributeKey: 'market', values: ['AZ'] }] });
    expect(result.columns.map((c) => [c.name, c.kind])).toEqual([['month', 'attribute'], ['claimsDenied', 'measure'], ['grossSavings', 'measure'], ['amount', 'measure']]);
    expect(result.columns[1].format).toBe('#,##0');
    expect(result.appliedFilters).toEqual([{ attributeKey: 'market', operator: 'IN', values: ['AZ'], source: 'request' }]);
    expect(result.rows).toEqual([{ month: '2026-09', claimsDenied: 44 }]);
  });

  it('accepts the React app payload as sent today (reportId ignored, extra keys tolerated, any key case)', () => {
    const { result } = call({ reportId: 'savings-invoice', CustomerId: 1, LineOfBusinessId: 1, Measures: ['CLAIMSDENIED'], Aggregates: [{ attributeKey: 'MONTH' }] });
    expect(result.status).toBe('OK');
    expect(result.columns[1].name).toBe('claimsDenied');
  });

  it('with no aggregates there is one row and the CTEs are cross joined', () => {
    const { result, finalSql } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['claimsDenied', 'amount'] });
    expect(result.status).toBe('OK');
    expect(finalSql).toContain('FROM c1 CROSS JOIN c2 LIMIT 10000');
    expect(finalSql).not.toContain('GROUP BY');
    expect(finalSql).not.toContain('ORDER BY');
  });

  it('computes derived measures from the base CTEs (numerator / NULLIF(denominator, 0) * multiplier)', () => {
    const { result, finalSql } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['savingsPerClaim'] });
    expect(result.status).toBe('OK');
    expect(finalSql).toContain('c1 AS (SELECT SUM(F.GROSS_SAVINGS) AS V');
    expect(finalSql).toContain('c2 AS (SELECT SUM(F.CLAIMS_DENIED) AS V');
    expect(finalSql).toContain('((c1.V / NULLIF(c2.V, 0)) * 100) AS "savingsPerClaim"');
  });

  it('applies measure-level filters inside that measure\'s CTE only', () => {
    const mfilters = [{ MEASUREID: 6, ATTRIBUTEKEY: 'programType', FILTERSTATEMENT: "IN ('CPI')" }];
    const { finalSql } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['claimsDenied', 'cpiClaims'] }, { snowflakeState: fakeSnowflake({ mfilters }) });
    expect(finalSql).toContain("WHERE F.CUSTOMER_ID = 1 AND (F.PROGRAM_TYPE IN ('CPI'))");
    expect(finalSql.match(/PROGRAM_TYPE IN \('CPI'\)/g)).toHaveLength(1);
  });

  it('supports paging and the filter operator whitelist', () => {
    const { finalSql } = call({ ...base, recordLimit: 50, recordStart: 100, filters: [{ attributeKey: 'month', operator: 'between', values: ['2026-01', '2026-06'] }, { attributeKey: 'market', operator: 'IS NOT NULL' }] });
    expect(finalSql).toContain("F.MONTH BETWEEN '2026-01' AND '2026-06'");
    expect(finalSql).toContain('F.MARKET IS NOT NULL');
    expect(finalSql).toContain('LIMIT 50 OFFSET 100');
  });

  it('treats an empty IN list as "all values"', () => {
    const { finalSql } = call({ ...base, filters: [{ attributeKey: 'market', values: [] }] });
    expect(finalSql).not.toContain('F.MARKET');
  });

  it('takes the line of business from the payload and never reads app tables (they live in the App DB)', () => {
    const { result, calls } = call({ ...base, lineOfBusinessId: 5, datasetId: 7 });
    expect(result.status).toBe('OK');
    expect(result.dataset).toEqual({ id: 7 });
    expect(calls.some((c) => /BI_ENGINE\.(CUSTOMER|DATASET|LINEOFBUSINESS)\b/.test(c.sqlText))).toBe(false);
    expect(calls.find((c) => c.sqlText.includes('FROM PI.BI_ENGINE.MEASURE_DETAILS')).binds).toEqual([5]);
    expect(calls.find((c) => c.sqlText.includes('FROM PI.BI_ENGINE.ATTRIBUTE_DETAILS')).binds[0]).toBe(5);
  });

  it('keeps cached SQL separate per line of business', () => {
    const hashInput = (lob) => call({ ...base, lineOfBusinessId: lob }).calls.find((c) => c.sqlText.includes('HASH(?)')).binds[0];
    expect(hashInput(1)).not.toBe(hashInput(2));
    expect(hashInput(1)).toBe(hashInput(1));
  });

  it('returns distinct attribute values for filter dropdowns', () => {
    const { result } = call({ customerId: 1, lineOfBusinessId: 1, attributeValues: ['market'] });
    expect(result.status).toBe('OK');
    expect(result.attributeValues).toEqual({ market: ['AZ', 'TX'] });
    expect(result.rows).toBeUndefined();
  });

  it('SQL_ONLY returns the SQL and does not run it', () => {
    const { result, finalSql } = call(base, { sqlOnly: true });
    expect(result.sql).toContain('WITH c1 AS');
    expect(finalSql).toBeNull();
    expect(result.rows).toBeUndefined();
  });
});

describe('BI_ENGINE.EXECUTE_QUERY: safety', () => {
  it('escapes quotes and backslashes in values', () => {
    const { finalSql } = call({ ...base, filters: [{ attributeKey: 'market', values: ["O'Brien\\", "x' OR '1'='1"] }] });
    expect(finalSql).toContain("IN ('O''Brien\\\\', 'x'' OR ''1''=''1')");
  });

  it.each([
    ['unknown measure', { ...base, measures: ['nope'] }, 'measures[0]'],
    ['unknown group attribute', { ...base, aggregates: [{ attributeKey: 'zzz' }] }, 'aggregates[0]'],
    ['unknown filter attribute', { ...base, filters: [{ attributeKey: "x'; DROP TABLE t; --", values: ['a'] }] }, 'filters[0].attributeKey'],
    ['operator not on the whitelist', { ...base, filters: [{ attributeKey: 'market', operator: '= 1 OR 1=1 --', values: ['a'] }] }, 'filters[0].operator'],
    ['wrong value count', { ...base, filters: [{ attributeKey: 'market', operator: '=', values: ['a', 'b'] }] }, 'filters[0].values'],
    ['control characters', { ...base, filters: [{ attributeKey: 'market', values: ['a\nb'] }] }, 'filters[0].values'],
    ['too many values', { ...base, filters: [{ attributeKey: 'market', values: Array.from({ length: 201 }, (_, i) => `v${i}`) }] }, 'filters[0].values'],
    ['months out of range', { ...base, months: 61 }, 'months'],
    ['missing customerId', { lineOfBusinessId: 1, measures: ['amount'] }, 'customerId'],
    ['missing lineOfBusinessId', { customerId: 1, measures: ['amount'] }, 'lineOfBusinessId'],
    ['no measures', { customerId: 1, lineOfBusinessId: 1 }, 'measures'],
  ])('rejects %s', (_name, payload, field) => {
    const { result, finalSql } = call(payload);
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_REQUEST', field });
    expect(finalSql).toBeNull();
  });

  it('rejects a payload that is not an object', () => {
    expect(call('[1,2]').result).toMatchObject({ status: 'ERROR', code: 'INVALID_REQUEST' });
    expect(call('not json').result.status).toBe('ERROR');
  });

  it('always scopes every CTE and the dropdown query to the customer id', () => {
    const { finalSql } = call({ ...base, customerId: 42, months: 6, filters: [{ attributeKey: 'market', values: ['AZ'] }] });
    const ctes = finalSql.match(/c\d AS \(.*?\)(?=, c\d AS|\s+SELECT COALESCE)/gs);
    expect(ctes).toHaveLength(3);
    ctes.forEach((c) => expect(c).toContain('F.CUSTOMER_ID = 42'));
    expect(finalSql).not.toContain('CUSTOMER_ID = 1');
    expect(call({ customerId: 42, lineOfBusinessId: 1, attributeValues: ['market'] }).calls.find((c) => c.sqlText.startsWith('SELECT DISTINCT')).sqlText)
      .toContain('F.CUSTOMER_ID = 42');
  });

  it('refuses metadata that contains statement separators or DDL/DML', () => {
    const { result, finalSql } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['evil'] });
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_METADATA' });
    expect(finalSql).toBeNull();
  });

  it('refuses a fact table outside PI.CORE', () => {
    const measures = [{ ...MEASURES[0], MEASUREFACT: 'OTHER_DB.PUBLIC.SECRETS' }];
    const { result } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['claimsDenied'] }, { snowflakeState: fakeSnowflake({ measures }) });
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_METADATA' });
  });

  it('detects measure definitions that point at each other', () => {
    const loop = [
      { ...MEASURES[3], MEASUREID: 10, MEASURE: 'a', BASENUMERATOR: 11, BASEDENOMINATOR: 11 },
      { ...MEASURES[3], MEASUREID: 11, MEASURE: 'b', BASENUMERATOR: 10, BASEDENOMINATOR: 10 },
    ];
    const { result } = call({ customerId: 1, lineOfBusinessId: 1, measures: ['a'] }, { snowflakeState: fakeSnowflake({ measures: loop }) });
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_METADATA' });
  });
});

describe('BI_ENGINE.EXECUTE_QUERY: cache, logging, errors', () => {
  it('stores generated SQL after a successful run and logs the call', () => {
    const { result, calls } = call(base);
    expect(result.cache).toEqual({ hit: false, hash: '-1234567890123456789' });
    expect(calls.some((c) => c.sqlText.startsWith('MERGE INTO PI.BI_ENGINE.EXECUTE_QUERY_CACHE'))).toBe(true);
    const log = inserts(calls, 'EXECUTE_QUERY_LOG')[0];
    expect(log.binds.slice(0, 3)).toEqual(['PI.BI_ENGINE.EXECUTE_QUERY', 'u1', '10.0.0.1']);
    expect(log.binds).toContain('OK');
  });

  it('reuses cached SQL and skips the metadata queries', () => {
    const cache = { GENERATED_SQL: 'WITH c1 AS (SELECT 1) SELECT 1', ANSWER: { columns: [{ name: 'x', kind: 'measure' }], appliedFilters: [] } };
    const { result, calls, finalSql } = call(base, { snowflakeState: fakeSnowflake({ cache }) });
    expect(result.cache.hit).toBe(true);
    expect(finalSql).toBe('WITH c1 AS (SELECT 1) SELECT 1');
    expect(calls.some((c) => c.sqlText.includes('MEASURE_DETAILS'))).toBe(false);
    expect(calls.some((c) => c.sqlText.startsWith('UPDATE PI.BI_ENGINE.EXECUTE_QUERY_CACHE SET USECOUNT'))).toBe(true);
  });

  it('USE_CACHE = false never reads or writes the cache', () => {
    const { result, calls } = call(base, { useCache: false });
    expect(result.cache.hit).toBe(false);
    expect(calls.some((c) => c.sqlText.includes('EXECUTE_QUERY_CACHE'))).toBe(false);
  });

  it('a failing query returns a generic error, writes the error log, and is not cached', () => {
    const { result, calls } = call(base, { snowflakeState: fakeSnowflake({ failFinal: true }) });
    expect(result).toMatchObject({ status: 'ERROR', code: 'INTERNAL', field: null });
    expect(result.message).not.toContain('boom');
    const err = inserts(calls, 'EXECUTE_QUERY_ERROR_LOG')[0];
    expect(err.binds[4]).toContain('boom');
    expect(err.binds[6]).toContain('WITH c1 AS');
    expect(calls.some((c) => c.sqlText.startsWith('MERGE INTO'))).toBe(false);
  });
});
