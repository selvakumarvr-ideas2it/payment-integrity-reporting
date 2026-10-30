export class ApiClientError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.field = field;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  /** Later 401s clear client auth and open /login. Login itself must show its own error. */
  redirectOn401?: boolean;
};

/** Same-origin JSON fetch. The session cookie is httpOnly, so credentials are included. */
export async function apiFetch<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return null as T;

  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string; field?: string }) : null;

  if (!response.ok) {
    const message = data?.error || response.statusText || 'Request failed';
    const error = new ApiClientError(message, response.status, data?.field);
    if (response.status === 401 && options.redirectOn401 !== false && !path.endsWith('/api/auth/login')) {
      redirectToLogin();
    }
    throw error;
  }
  return data as T;
}

export function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  const next = `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ notice: 'expired' });
  if (next && next !== '/') params.set('next', next);
  window.location.assign(`/login?${params.toString()}`);
}
