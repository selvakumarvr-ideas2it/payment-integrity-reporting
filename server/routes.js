// HTTP-agnostic route table: handle({ method, path, headers, body, clientIp }) -> { status, body }.
// server/function-api.mjs hosts it on node:http; an Azure Functions app.http() wrapper can reuse it as is.
import { authenticate, bearerToken, login, logout } from './auth.js';
import { createDataset, deleteDataset, getDataset, listDatasets, updateDataset } from './datasets.js';
import { ApiError, notFound } from './errors.js';
import { createPostgresExecuteQuery } from './query.js';

export function createApi(pool, { executeQuery, ping, backend = 'postgres' } = {}) {
  const runQuery = executeQuery || createPostgresExecuteQuery(pool);
  const routes = [
    ['GET', /^\/api\/health$/, false, async () => {
      await pool.query('SELECT 1');
      if (ping) await ping();
      return { status: 'ok', biEngine: backend };
    }],
    ['POST', /^\/api\/auth\/login$/, false, ({ body }) => login(pool, body)],
    ['POST', /^\/api\/auth\/logout$/, false, async ({ token }) => {
      await logout(pool, token);
      return null;
    }],
    ['GET', /^\/api\/auth\/me$/, true, ({ user }) => ({ user })],
    ['POST', /^\/api\/query$/, true, ({ user, body, clientIp }) => runQuery(user, body, { clientIp })],
    ['GET', /^\/api\/datasets$/, true, async ({ user }) => ({ datasets: await listDatasets(pool, user) })],
    ['POST', /^\/api\/datasets$/, true, async ({ user, body }) => ({ status: 201, body: await createDataset(pool, user, body) })],
    ['GET', /^\/api\/datasets\/([^/]+)$/, true, ({ user, params }) => getDataset(pool, user, params[0])],
    ['PUT', /^\/api\/datasets\/([^/]+)$/, true, ({ user, params, body }) => updateDataset(pool, user, params[0], body)],
    ['DELETE', /^\/api\/datasets\/([^/]+)$/, true, async ({ user, params }) => {
      await deleteDataset(pool, user, params[0]);
      return null;
    }],
  ];

  return async function handle({ method, path, headers = {}, body, clientIp }) {
    try {
      const pathMatches = routes.filter(([, re]) => re.test(path));
      if (!pathMatches.length) throw notFound(`No route for ${path}`);
      const route = pathMatches.find(([m]) => m === method);
      if (!route) return { status: 405, body: { error: `${method} not allowed on ${path}` } };

      const [, re, needsAuth, fn] = route;
      const token = bearerToken(headers);
      const user = needsAuth ? await authenticate(pool, token) : null;
      const result = await fn({ user, token, body: body ?? {}, params: re.exec(path).slice(1), clientIp });
      if (result === null) return { status: 204, body: null };
      if (result && 'status' in result && 'body' in result) return result;
      return { status: 200, body: result };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...(e.field ? { field: e.field } : {}) } };
      console.error(e);
      return { status: 500, body: { error: 'Internal server error' } };
    }
  };
}
