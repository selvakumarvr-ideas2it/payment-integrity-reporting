import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { withErrors } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  await db.execute(sql`select 1`);
  return { ok: true };
});
