import { requireUser } from '@/server/auth';
import { withErrors } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const user = await requireUser();
  return { user };
});
