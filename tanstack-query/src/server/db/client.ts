import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  piPool?: pg.Pool;
  piDb?: Database;
  piUrl?: string;
};

export function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (globalForDb.piPool && globalForDb.piUrl !== connectionString) {
    void globalForDb.piPool.end();
    globalForDb.piPool = undefined;
    globalForDb.piDb = undefined;
  }
  if (!globalForDb.piPool) {
    globalForDb.piUrl = connectionString;
    globalForDb.piPool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
  }
  return globalForDb.piPool;
}

/** One Drizzle client for the Next.js process, opened from DATABASE_URL. */
export function getDb(): Database {
  if (!globalForDb.piDb) globalForDb.piDb = drizzle(getPool(), { schema });
  return globalForDb.piDb;
}

export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, property, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
