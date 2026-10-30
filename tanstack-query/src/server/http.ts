import { SESSION_COOKIE } from '@/session-cookie';

/** An error the route handler turns into `{ error, field? }` and an HTTP status. */
export class HttpError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(status: number, message: string, field?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.field = field;
  }
}

export const badRequest = (message: string, field?: string) => new HttpError(400, message, field);
export const unauthorized = (message = 'Your session expired') => new HttpError(401, message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, field?: string) => new HttpError(409, message, field);

const LOGIN_FAILURE = 'Invalid username or password';

async function clearSessionCookie() {
  const { cookies } = await import('next/headers');
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

type RouteContext = { params: Promise<Record<string, string>> };

/** Route handlers call services. This wrapper maps HttpError onto the JSON status codes. */
export function withErrors(handler: (request: Request, context: RouteContext) => Promise<Response | unknown>) {
  return async (request: Request, context: RouteContext) => {
    try {
      const result = await handler(request, context);
      if (result instanceof Response) return result;
      if (result === undefined) return new Response(null, { status: 204 });
      return Response.json(result);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export async function toErrorResponse(error: unknown): Promise<Response> {
  if (error instanceof HttpError) {
    if (error.status === 401 && error.message !== LOGIN_FAILURE) await clearSessionCookie();
    const body: { error: string; field?: string } = { error: error.message };
    if (error.field) body.field = error.field;
    return Response.json(body, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && (current as { code?: string }).code === '23505') return true;
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
