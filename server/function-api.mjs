// Payment Integrity Function API (Node 24, Postgres).
//   npm run api        -> http://localhost:7071/api/...
// Needs Postgres with the schema loaded: `npm run db:up` then `npm run db:setup`.
import { createServer } from 'node:http';
import { createPool } from './db/pool.js';
import { createApi } from './routes.js';

const PORT = Number(process.env.API_PORT || 7071);
const MAX_BODY = 1024 * 1024;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';

const pool = createPool();
const handle = createApi(pool);

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

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, e.status, { error: e.message });
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  const result = await handle({ method: req.method, path: pathname.replace(/\/$/, ''), headers: req.headers, body });
  send(res, result.status, result.body);
});

server.listen(PORT, async () => {
  console.log(`Function API on http://localhost:${PORT}/api`);
  try {
    await pool.query('SELECT 1 FROM pi.report LIMIT 1');
  } catch (e) {
    console.warn(`Database not ready (${e.message}). Run: npm run db:up && npm run db:setup`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
