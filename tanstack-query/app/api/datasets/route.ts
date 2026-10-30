import { requireUser } from '@/server/auth';
import { createDataset, listDatasets } from '@/server/datasets';
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

export const GET = withErrors(async () => {
  const user = await requireUser();
  const datasets = await listDatasets(user);
  return { datasets };
});

export const POST = withErrors(async (request) => {
  const user = await requireUser();
  const dataset = await createDataset(user, await readJson(request));
  return Response.json(dataset, { status: 201 });
});
