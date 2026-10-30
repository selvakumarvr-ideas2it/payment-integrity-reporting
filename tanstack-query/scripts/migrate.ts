import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLocalEnv } from './load-env';

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'drizzle');
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(dir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error(`No SQL files in ${dir}`);
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM drizzle.schema_migrations WHERE filename = $1', [file]);
    if (applied.rowCount) {
      console.log(`skip ${file}`);
      continue;
    }
    const sqlText = await readFile(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sqlText);
      await client.query('INSERT INTO drizzle.schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
