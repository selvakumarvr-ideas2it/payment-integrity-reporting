// Payment Integrity Function API (Node 24).
//   npm run api        -> http://localhost:7071/api/...
// Auth, sessions and datasets live in Postgres. The Query API calls Snowflake PI.BI_ENGINE.EXECUTE_QUERY
// when BI_ENGINE_BACKEND=snowflake (the default here), or Postgres bi_engine.execute_query otherwise.
import { createServer } from 'node:http';
import { createPool } from './db/pool.js';
import { createSnowflake } from './db/snowflake.js';
import { createExecuteQuery } from './query.js';
import { createApi } from './routes.js';

const PORT = Number(process.env.API_PORT || 7071);
const MAX_BODY = 1024 * 1024;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
const backend = (process.env.BI_ENGINE_BACKEND || 'snowflake').toLowerCase();

const pool = createPool();
const snowflake = backend === 'snowflake' ? createSnowflake() : null;
const executeQuery = createExecuteQuery({ pool, snowflake, backend });
const handle = createApi(pool, { executeQuery, ping: snowflake?.ping.bind(snowflake), backend });

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-functions-key',
};

function send(res, status, body) {
  res.writeHead(status, { ...cors, ...(body === null ? {} : { 'Content-Type': 'application/json' }) });
  res.end(body === null ? undefined : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Request body is not valid JSON'), { status: 400 });
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, e.status, { error: e.message });
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  const result = await handle({
    method: req.method,
    path: pathname.replace(/\/$/, ''),
    headers: req.headers,
    body,
    clientIp: clientIp(req),
  });
  send(res, result.status, result.body);
});

server.listen(PORT, async () => {
  console.log(`Function API on http://localhost:${PORT}/api`);
  try {
    await pool.query('SELECT 1 FROM pi.report LIMIT 1');
  } catch (e) {
    console.warn(`Postgres not ready (${e.message}). Run: npm run db:up && npm run db:setup`);
  }
  if (backend === 'snowflake') {
    try {
      await snowflake.ping();
      console.log(`BI engine: Snowflake PI.BI_ENGINE.EXECUTE_QUERY (${snowflake.host})`);
    } catch (e) {
      console.warn(`Snowflake not ready (${e.message}). Check SNOWFLAKE_* in .env.local, or set BI_ENGINE_BACKEND=postgres.`);
    }
  } else {
    console.log('BI engine: Postgres bi_engine.execute_query');
  }
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    if (snowflake) await snowflake.close();
    process.exit(0);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
