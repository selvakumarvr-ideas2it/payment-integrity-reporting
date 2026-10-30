import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadLocalEnv } from '../../scripts/load-env';
import type { MeasureKey, SavingsInvoiceResponse, SessionUser } from '@/model';
import { loginUser } from './auth';
import { getDb, getPool } from './db/client';
import { dataset } from './db/schema';
import { createDataset, deleteDataset, listDatasets, updateDataset } from './datasets';
import { HttpError } from './http';
import { runSavingsInvoice } from './savings-invoice';

loadLocalEnv();

const password = process.env.SEED_PASSWORD || 'Password123!';

async function databaseReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      'DATABASE_URL is not set; skipping database tests. Copy .env.example to .env.local, then run npm run db:up, npm run db:migrate, and npm run db:seed.',
    );
    return false;
  }
  try {
    await getPool().query('select 1');
    const result = await getPool().query('select count(*)::int as n from pi.fact_savings');
    if (result.rows[0].n < 1) {
      console.warn('pi.fact_savings is empty; skipping database tests. Run npm run db:seed.');
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `Database not reachable (${error instanceof Error ? error.message : error}); skipping database tests. Start Postgres with npm run db:up, then npm run db:migrate and npm run db:seed.`,
    );
    return false;
  }
}

const ready = await databaseReady();

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  await getPool().end();
});

const kpi = (result: SavingsInvoiceResponse, key: MeasureKey) => result.kpis.find((item) => item.key === key)?.value ?? 0;

async function loadUser(username: string): Promise<SessionUser> {
  const result = await getPool().query(
    `select u.user_id as id, u.username, u.display_name as "displayName", u.customer_id as "customerId", c.name as customer
     from pi.users u join pi.customer c using (customer_id) where lower(u.username) = lower($1)`,
    [username],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Seed user ${username} is missing. Run npm run db:seed.`);
  return row;
}

describe.skipIf(!ready)('savings invoice database', () => {
  const created: number[] = [];

  afterAll(async () => {
    if (!ready) return;
    const analyst = await loadUser('analyst');
    for (const id of created) {
      await deleteDataset(analyst, id).catch(() => undefined);
    }
  });

  it('rejects a bad password and a missing user with the same message', async () => {
    const badPassword = await loginUser('analyst', 'wrong-password').then(
      () => null,
      (error) => error,
    );
    const missingUser = await loginUser('nobody', password).then(
      () => null,
      (error) => error,
    );
    expect(badPassword).toBeInstanceOf(HttpError);
    expect(missingUser).toBeInstanceOf(HttpError);
    expect(badPassword.status).toBe(401);
    expect(missingUser.message).toBe(badPassword.message);
    expect(badPassword.message).toBe('Invalid username or password');
  });

  it('rejects a duplicate dataset name and an update by someone who is not the owner', async () => {
    const analyst = await loadUser('analyst');
    const reviewer = await loadUser('reviewer');
    const name = `vitest-${Date.now()}`;
    const filters = [{ attributeKey: 'market' as const, values: ['OH'] }];
    const first = await createDataset(analyst, { name, filters });
    created.push(first.id);
    const duplicate = await createDataset(analyst, { name: name.toUpperCase(), filters }).then(
      () => null,
      (error) => error,
    );
    expect(duplicate).toMatchObject({ status: 409, field: 'name' });

    await getDb().update(dataset).set({ readpolicyId: 2 }).where(eq(dataset.datasetId, first.id));
    const forbidden = await updateDataset(reviewer, first.id, { name: `${name}-hijack` }).then(
      () => null,
      (error) => error,
    );
    expect(forbidden).toMatchObject({ status: 403 });

    const hidden = await createDataset(analyst, { name: `${name}-private`, filters });
    created.push(hidden.id);
    const invisible = await updateDataset(reviewer, hidden.id, { name: 'nope' }).then(
      () => null,
      (error) => error,
    );
    expect(invisible).toMatchObject({ status: 404 });
  });

  it('ORs values in one filter, ANDs filters, and ANDs a dataset with request filters', async () => {
    const analyst = await loadUser('analyst');
    const az = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', filters: [{ attributeKey: 'market', values: ['AZ'] }] });
    const tx = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', filters: [{ attributeKey: 'market', values: ['TX'] }] });
    const both = await runSavingsInvoice(analyst, {
      reportId: 'savings-invoice',
      filters: [{ attributeKey: 'market', values: ['AZ', 'TX'] }],
    });
    expect(kpi(both, 'claimsDenied')).toBe(kpi(az, 'claimsDenied') + kpi(tx, 'claimsDenied'));

    const azCpi = await runSavingsInvoice(analyst, {
      reportId: 'savings-invoice',
      filters: [
        { attributeKey: 'market', values: ['AZ'] },
        { attributeKey: 'programType', values: ['CPI'] },
      ],
    });
    expect(kpi(azCpi, 'claimsDenied')).toBeLessThan(kpi(az, 'claimsDenied'));

    const datasets = await listDatasets(analyst);
    const southwest = datasets.find((item) => item.name === 'Southwest-EDC');
    expect(southwest).toBeTruthy();
    const byDataset = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', datasetId: southwest!.id });
    const narrowed = await runSavingsInvoice(analyst, {
      reportId: 'savings-invoice',
      datasetId: southwest!.id,
      filters: [{ attributeKey: 'market', values: ['AZ'] }],
    });
    const byHand = await runSavingsInvoice(analyst, {
      reportId: 'savings-invoice',
      filters: [
        { attributeKey: 'market', values: ['AZ'] },
        { attributeKey: 'programType', values: ['EDC'] },
      ],
    });
    expect(kpi(narrowed, 'claimsDenied')).toBe(kpi(byHand, 'claimsDenied'));
    expect(kpi(narrowed, 'claimsDenied')).toBeLessThan(kpi(byDataset, 'claimsDenied'));
    expect(narrowed.appliedFilters.map((filter) => filter.source).sort()).toEqual(['dataset', 'dataset', 'request']);
  });

  it('keeps the latest N months and ignores a customer id in the body', async () => {
    const analyst = await loadUser('analyst');
    const full = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', months: 24, customerId: 999 });
    expect(full.report.customer).toBe('Centene');
    expect(full.rows).toHaveLength(24);
    expect(full.rows[0]?.month).toBe('2026-09');
    expect(full.rows.at(-1)?.month).toBe('2024-10');
    expect(full.report.from).toBe('2024-10');
    expect(full.report.to).toBe('2026-09');
    expect(full.dataset).toBeNull();

    const one = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', months: 1 });
    expect(one.rows.map((row) => row.month)).toEqual(['2026-09']);
    const three = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', months: 3 });
    expect(three.rows.map((row) => row.month)).toEqual(['2026-09', '2026-08', '2026-07']);

    const spoofed = await runSavingsInvoice(analyst, { reportId: 'savings-invoice', customerId: 2 });
    expect(spoofed.rows).toEqual(full.rows);
    expect(spoofed.kpis).toEqual(full.kpis);
  });

  it('returns filter options for the customer even when a filter is active', async () => {
    const analyst = await loadUser('analyst');
    const filtered = await runSavingsInvoice(analyst, {
      reportId: 'savings-invoice',
      filters: [{ attributeKey: 'market', values: ['AZ'] }],
    });
    expect(filtered.filterOptions.market).toHaveLength(50);
    expect(filtered.filterOptions.market).toContain('TX');
    expect(filtered.filterOptions.programType).toEqual(['CPI', 'EDC']);
    expect(filtered.rows.length).toBeGreaterThan(0);
    const markets = await getPool().query(
      'select count(distinct market)::int as n from pi.fact_savings where customer_id = $1',
      [analyst.customerId],
    );
    expect(filtered.filterOptions.market).toHaveLength(markets.rows[0].n);
  });
});
