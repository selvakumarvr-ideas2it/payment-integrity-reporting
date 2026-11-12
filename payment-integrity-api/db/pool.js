import pg from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://pi:pi@localhost:5432/pi';

export function createPool(connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Run fn(client) inside a transaction; roll back if it throws. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
