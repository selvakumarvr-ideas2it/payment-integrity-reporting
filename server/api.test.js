// Integration tests against the local Postgres (npm run db:up && npm run db:setup).
// Skipped when the database is not reachable or not set up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db/pool.js';
import { createApi } from './routes.js';

const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
const pool = createPool();
const dbReady = await pool
  .query('SELECT count(*)::int AS n FROM pi.fact_savings')
  .then((r) => r.rows[0].n > 0)
  .catch(() => false);
if (!dbReady) console.warn('Postgres not set up; skipping server tests (npm run db:up && npm run db:setup)');

const api = createApi(pool);
const call = (method, path, body, token) =>
  api({ method, path, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const signIn = async (username) => (await call('POST', '/api/auth/login', { username, password: PASSWORD })).body.token;
const kpi = (res, key) => res.body.kpis.find((k) => k.key === key).value;

describe.skipIf(!dbReady)('Function API + BI_Engine stored procedure', () => {
  let analyst;
  let reviewer;
  const created = [];

  beforeAll(async () => {
    analyst = await signIn('analyst');
    reviewer = await signIn('reviewer');
  });

  afterAll(async () => {
    for (const id of created) await call('DELETE', `/api/datasets/${id}`, null, analyst);
    await pool.end();
  });

  it('requires sign-in and rejects bad passwords', async () => {
    expect((await call('POST', '/api/query', {})).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'analyst', password: 'nope' })).status).toBe(401);
  });

  it('returns 24 months and KPIs that equal the sum of the rows', async () => {
    const res = await call('POST', '/api/query', { reportId: 'savings-invoice', months: 24 }, analyst);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(24);
    const sum = res.body.rows.reduce((s, r) => s + r.claimsDenied, 0);
    expect(kpi(res, 'claimsDenied')).toBe(sum);
    expect(res.body.filterOptions.market).toHaveLength(50);
    expect(res.body.filterOptions.programType).toEqual(['CPI', 'EDC']);
  });

  it('gives the same result for a saved dataset and the same filters picked by hand', async () => {
    const { datasets } = (await call('GET', '/api/datasets', null, analyst)).body;
    const az = datasets.find((d) => d.name === 'Arizona-CPI');
    const byId = await call('POST', '/api/query', { datasetId: az.id }, analyst);
    const byHand = await call(
      'POST',
      '/api/query',
      { filters: [{ attributeKey: 'market', values: ['AZ'] }, { attributeKey: 'programType', values: ['CPI'] }] },
      analyst,
    );
    expect(byId.body.dataset).toEqual({ id: az.id, name: 'Arizona-CPI' });
    expect(byId.body.kpis).toEqual(byHand.body.kpis);
    expect(byId.body.rows).toEqual(byHand.body.rows);
  });

  it('treats multi-select values as OR within a filter', async () => {
    const q = (values) => call('POST', '/api/query', { filters: [{ attributeKey: 'market', values }] }, analyst);
    const [az, tx, both] = await Promise.all([q(['AZ']), q(['TX']), q(['AZ', 'TX'])]);
    expect(kpi(both, 'claimsDenied')).toBe(kpi(az, 'claimsDenied') + kpi(tx, 'claimsDenied'));
  });

  it('rejects anything outside the catalog and binds values as parameters', async () => {
    const bad = (body) => call('POST', '/api/query', body, analyst);
    expect((await bad({ measures: ['sum(1); drop table pi.users'] })).body.field).toBe('measures[0]');
    expect((await bad({ filters: [{ attributeKey: 'customer_id', values: ['2'] }] })).status).toBe(400);
    expect((await bad({ months: 61 })).status).toBe(400);
    const injected = await bad({ filters: [{ attributeKey: 'market', values: ["AZ' OR '1'='1"] }] });
    expect(injected.status).toBe(200);
    expect(kpi(injected, 'claimsDenied')).toBe(0);
  });

  it('creates, updates and deletes a dataset owned by the signed-in user', async () => {
    const res = await call('POST', '/api/datasets', { name: 'Test Ohio', filters: [{ attributeKey: 'market', values: ['OH', 'PA'] }] }, analyst);
    expect(res.status).toBe(201);
    created.push(res.body.id);
    expect(res.body.filters).toEqual([{ attributeKey: 'market', values: ['OH', 'PA'] }]);

    expect((await call('POST', '/api/datasets', { name: 'test ohio', filters: [{ attributeKey: 'market', values: ['OH'] }] }, analyst)).status).toBe(409);
    expect((await call('POST', '/api/datasets', { name: 'Bad', filters: [{ attributeKey: 'market', values: ['ZZ'] }] }, analyst)).status).toBe(400);

    const upd = await call('PUT', `/api/datasets/${res.body.id}`, { filters: [{ attributeKey: 'programType', values: ['EDC'] }] }, analyst);
    expect(upd.body.filters).toEqual([{ attributeKey: 'programType', values: ['EDC'] }]);

    expect((await call('DELETE', `/api/datasets/${res.body.id}`, null, analyst)).status).toBe(204);
    created.pop();
  });

  it("keeps private datasets away from other users", async () => {
    const { datasets } = (await call('GET', '/api/datasets', null, analyst)).body;
    const az = datasets.find((d) => d.name === 'Arizona-CPI');
    const theirs = (await call('GET', '/api/datasets', null, reviewer)).body.datasets.map((d) => d.name);
    expect(theirs).toEqual(['Texas-All']);
    expect((await call('GET', `/api/datasets/${az.id}`, null, reviewer)).status).toBe(404);
    expect((await call('POST', '/api/query', { datasetId: az.id }, reviewer)).status).toBe(404);
    expect((await call('DELETE', `/api/datasets/${az.id}`, null, reviewer)).status).toBe(404);
  });

  it('ends the session on logout', async () => {
    const token = await signIn('analyst');
    expect((await call('POST', '/api/auth/logout', null, token)).status).toBe(204);
    expect((await call('GET', '/api/auth/me', null, token)).status).toBe(401);
  });
});
