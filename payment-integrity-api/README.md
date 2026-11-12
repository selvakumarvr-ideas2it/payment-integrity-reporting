# Payment Integrity API

App API for Payment Integrity Reporting: sign-in, sessions, saved datasets, and a Postgres `bi_engine.execute_query` rollback used by tests.

The React app lives in the sibling project `payment-integrity-reporting`. Report queries in the browser go to the Azure Function App (`/api/v1/...`), not this service.

```
React ──GET/POST /api/auth, /api/datasets──▶ App API (this repo) :7071 ──▶ Postgres 16
```

## Run it

```bash
nvm use                      # Node 24
npm install
cp .env.example .env.local   # optional; defaults work locally

npm run db:up                # Postgres 16 in Docker (localhost:5432, user/password/db: pi)
npm run db:setup             # schemas, users, fact rows, example datasets
npm start                    # http://localhost:7071/api
# or: npm run dev            # same, with --watch
```

Sign in as **analyst** or **reviewer**, password `Password123!` (or `SEED_PASSWORD`).

```bash
npm test                     # integration tests (skipped if Postgres is not set up)
npm run db:down              # stop Postgres (data stays in the pi-pgdata volume)
```

## Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://pi:pi@localhost:5432/pi` | Postgres |
| `API_PORT` | `7071` | Listen port |
| `CORS_ORIGIN` | `*` | Allowed origin for browser calls that skip the Vite proxy |
| `SEED_PASSWORD` | `Password123!` | Password `npm run db:setup` gives the demo users |

## Endpoints

All routes except `health` and `auth/login` need `Authorization: Bearer <token>`. Errors are `{ "error": "...", "field"?: "..." }`.

| Method and path | Purpose |
|---|---|
| `POST /api/auth/login` | `{ username, password }` → `{ token, expiresAt, user }` (8-hour session) |
| `POST /api/auth/logout` | End the session |
| `GET /api/auth/me` | Current user |
| `GET /api/datasets` | The user's datasets, then public ones |
| `POST /api/datasets` | `{ name, description?, periods, filters? }` → 201 |
| `GET` / `PUT` / `DELETE /api/datasets/:id` | Read / change / delete; only the owner can change or delete |
| `GET /api/health` | Postgres check |
| `POST /api/query` | Postgres `bi_engine.execute_query` rollback (used by tests) |

A **dataset** is an HPM time-period configuration (current/prior service, payment and enrollment dates) plus optional Market / Program Type filters.

## Layout

```
app-api.mjs           HTTP host (npm start)
routes.js             route table
auth.js               scrypt passwords, hashed session tokens
datasets.js           dataset service
query.js              Postgres execute_query adapter
datasetPeriods.js     time-period helpers (keep in sync with the React app)
db/pool.js            pg pool
db/sql/               schema, stored procedure, catalog
scripts/db-setup.mjs  rebuild and seed
data/                 seed fact rows
docker-compose.yml    local Postgres 16
```
