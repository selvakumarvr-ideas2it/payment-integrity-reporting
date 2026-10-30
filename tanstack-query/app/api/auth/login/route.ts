import { createSession, loginUser, setSessionCookie } from '@/server/auth';
import { badRequest, withErrors } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must be JSON');
  }
  const record = (body ?? {}) as { username?: unknown; password?: unknown };
  const user = await loginUser(record.username, record.password);
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return { user };
});
