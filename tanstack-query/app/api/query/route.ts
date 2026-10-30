import { requireUser } from '@/server/auth';
import { badRequest, withErrors } from '@/server/http';
import { runSavingsInvoice } from '@/server/savings-invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (request) => {
  const user = await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must be JSON');
  }
  return runSavingsInvoice(user, body);
});
