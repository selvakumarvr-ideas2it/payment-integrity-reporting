import { sql } from 'drizzle-orm';
import { loadLocalEnv } from './load-env';
import { SYNTHETIC_ROW_COUNT, SYNTHETIC_SEED, syntheticFacts } from './synthetic-facts';

loadLocalEnv();

const { hashPassword } = await import('../src/server/auth');
const { getDb, getPool } = await import('../src/server/db/client');
const { customer, dataset, datasetFilter, factSavings, userSession, users } = await import('../src/server/db/schema');

const password = process.env.SEED_PASSWORD || 'Password123!';
const passwordSource = process.env.SEED_PASSWORD ? 'SEED_PASSWORD environment variable' : 'built-in default Password123!';

const DEMO_USERS = [
  { username: 'analyst', displayName: 'Alex Analyst' },
  { username: 'reviewer', displayName: 'Riley Reviewer' },
] as const;

const DATASETS: Record<string, { name: string; description: string; filters: { attributeKey: 'market' | 'programType'; values: string[] }[] }[]> = {
  analyst: [
    {
      name: 'Arizona-CPI',
      description: 'Arizona, CPI program',
      filters: [
        { attributeKey: 'market', values: ['AZ'] },
        { attributeKey: 'programType', values: ['CPI'] },
      ],
    },
    {
      name: 'Southwest-EDC',
      description: 'AZ, NM and TX, EDC program',
      filters: [
        { attributeKey: 'market', values: ['AZ', 'NM', 'TX'] },
        { attributeKey: 'programType', values: ['EDC'] },
      ],
    },
    {
      name: 'Big Four States',
      description: 'CA, FL, NY and TX, all programs',
      filters: [{ attributeKey: 'market', values: ['CA', 'FL', 'NY', 'TX'] }],
    },
  ],
  reviewer: [
    {
      name: 'Texas-All',
      description: 'Texas, all programs',
      filters: [{ attributeKey: 'market', values: ['TX'] }],
    },
  ],
};

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  process.exit(1);
}

const db = getDb();

try {
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: customer.customerId }).from(customer).limit(1);
    if (existing.length && process.env.SEED_RESET !== '1') {
      throw new Error(
        'Database already contains customer data. Refusing to insert duplicate seed rows. Set SEED_RESET=1 to delete rows in the child tables and reload.',
      );
    }
    if (existing.length) {
      await tx.update(dataset).set({ copiedFromDatasetId: null });
      await tx.delete(datasetFilter);
      await tx.delete(dataset);
      await tx.delete(factSavings);
      await tx.delete(userSession);
      await tx.delete(users);
      await tx.delete(customer);
    }

    await tx.insert(customer).values({ customerId: 1, name: 'Centene' });
    const insertedUsers = await tx
      .insert(users)
      .values(
        DEMO_USERS.map((user) => ({
          username: user.username,
          displayName: user.displayName,
          passwordHash: hashPassword(password),
          customerId: 1,
        })),
      )
      .returning({ id: users.userId, username: users.username });

    const facts = syntheticFacts();
    if (facts.length !== SYNTHETIC_ROW_COUNT) {
      throw new Error(`Expected ${SYNTHETIC_ROW_COUNT} synthetic fact rows, got ${facts.length}`);
    }
    const chunkSize = 500;
    for (let index = 0; index < facts.length; index += chunkSize) {
      await tx.insert(factSavings).values(
        facts.slice(index, index + chunkSize).map((row) => ({
          customerId: 1,
          month: row.month,
          market: row.market,
          programType: row.programType,
          claimsDenied: row.claimsDenied,
          grossSavings: row.grossSavings,
          amount: row.amount,
        })),
      );
    }

    for (const user of insertedUsers) {
      for (const entry of DATASETS[user.username] ?? []) {
        const inserted = await tx
          .insert(dataset)
          .values({
            customerId: 1,
            name: entry.name,
            description: entry.description,
            ownerUserId: user.id,
            readpolicyId: 1,
            createdUserId: user.id,
            lastModifiedUserId: user.id,
          })
          .returning({ id: dataset.datasetId });
        const datasetId = inserted[0]?.id;
        if (!datasetId) throw new Error(`Could not insert dataset ${entry.name}`);
        await tx.insert(datasetFilter).values(
          entry.filters.flatMap((filter) => filter.values.map((value) => ({ datasetId, attributeKey: filter.attributeKey, value }))),
        );
      }
    }

    const [loaded] = await tx.select({ count: sql<number>`count(*)::int` }).from(factSavings);
    if (Number(loaded?.count) !== SYNTHETIC_ROW_COUNT) {
      throw new Error(`Expected ${SYNTHETIC_ROW_COUNT} fact rows, found ${loaded?.count ?? 0}`);
    }
  });

  console.log(`Loaded ${SYNTHETIC_ROW_COUNT} synthetic fact rows (seed ${SYNTHETIC_SEED}). Figures are synthetic.`);
  console.log(`Users: ${DEMO_USERS.map((user) => user.username).join(', ')}`);
  console.log(`Password source: ${passwordSource}`);
  console.log('Datasets: analyst Arizona-CPI, Southwest-EDC, Big Four States; reviewer Texas-All');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
