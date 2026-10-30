import { logout } from '@/server/auth';
import { withErrors } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async () => {
  await logout();
  return new Response(null, { status: 204 });
});
