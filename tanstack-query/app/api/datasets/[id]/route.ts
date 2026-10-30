import { requireUser } from '@/server/auth';
import { deleteDataset, getDataset, updateDataset } from '@/server/datasets';
import { badRequest, HttpError, withErrors } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest('Request body must be JSON');
  }
}

export const GET = withErrors(async (_request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  return getDataset(user, id);
});

export const PUT = withErrors(async (request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  return updateDataset(user, id, await readJson(request));
});

export const DELETE = withErrors(async (_request, context) => {
  const user = await requireUser();
  const { id } = await context.params;
  await deleteDataset(user, id);
  return new Response(null, { status: 204 });
});
