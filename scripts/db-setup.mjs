// Rebuilds the local Postgres database: drops and recreates the pi and bi_engine schemas, applies
// server/db/sql/*.sql in order, then loads users, the synthetic fact rows and example datasets.
//   npm run db:setup
// DATABASE_URL defaults to the docker-compose database; SEED_PASSWORD sets the demo users' password.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, withTransaction } from '../server/db/pool.js';
import { hashPassword } from '../server/auth.js';
import { createDataset } from '../server/datasets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = join(root, 'server', 'db', 'sql');
const FACTS = join(root, 'public', 'data', 'savings-invoice.json');
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

const CUSTOMER = { id: 1, name: 'Centene' };
const USERS = [
  { username: 'analyst', displayName: 'Alex Analyst' },
  { username: 'reviewer', displayName: 'Riley Reviewer' },
];
const DATASETS = {
  analyst: [
    { name: 'Arizona-CPI', description: 'Arizona, CPI program', filters: { market: ['AZ'], programType: ['CPI'] } },
    { name: 'Southwest-EDC', description: 'AZ, NM and TX, EDC program', filters: { market: ['AZ', 'NM', 'TX'], programType: ['EDC'] } },
    { name: 'Big Four States', description: 'CA, FL, NY and TX, all programs', filters: { market: ['CA', 'FL', 'NY', 'TX'] } },
  ],
  reviewer: [{ name: 'Texas-All', description: 'Texas, all programs', filters: { market: ['TX'] } }],
};

const pool = createPool();
try {
  const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  await withTransaction(pool, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS bi_engine CASCADE; DROP SCHEMA IF EXISTS pi CASCADE;');
    for (const f of files) {
      await client.query(await readFile(join(SQL_DIR, f), 'utf8'));
      console.log(`applied ${f}`);
    }

    await client.query('INSERT INTO pi.customer (customer_id, name) VALUES ($1, $2)', [CUSTOMER.id, CUSTOMER.name]);
    for (const u of USERS)
      await client.query('INSERT INTO pi.users (username, display_name, password_hash, customer_id) VALUES ($1, $2, $3, $4)', [
        u.username,
        u.displayName,
        hashPassword(PASSWORD),
        CUSTOMER.id,
      ]);

    const { rows } = JSON.parse(await readFile(FACTS, 'utf8'));
    await client.query(
      `INSERT INTO pi.fact_savings (customer_id, month, market, program_type, claims_denied, gross_savings, amount)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::numeric[], $7::numeric[])`,
      [
        CUSTOMER.id,
        rows.map((r) => r.month),
        rows.map((r) => r.market),
        rows.map((r) => r.programType),
        rows.map((r) => r.claimsDenied),
        rows.map((r) => r.grossSavings),
        rows.map((r) => r.amount),
      ],
    );
    console.log(`loaded ${rows.length} fact rows`);
  });

  // Datasets go through the same service as the API, so they are validated the same way.
  const { rows: users } = await pool.query('SELECT user_id AS id, username, customer_id AS "customerId" FROM pi.users');
  for (const u of users)
    for (const d of DATASETS[u.username] || []) {
      const filters = Object.entries(d.filters).map(([attributeKey, values]) => ({ attributeKey, values }));
      await createDataset(pool, u, { name: d.name, description: d.description, filters });
      console.log(`dataset ${u.username}/${d.name}`);
    }

  console.log(`\nDone. Sign in as ${USERS.map((u) => u.username).join(' or ')} with password ${process.env.SEED_PASSWORD ? '$SEED_PASSWORD' : PASSWORD}`);
} finally {
  await pool.end();
}
