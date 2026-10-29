# Payment Integrity Reporting

React app and Node Function API for the Payment Integrity (PI) **Savings Invoice** report: a Centene view of prepay savings by month, styled after the Health Plan Manager shell.

```
React page ──POST /api/query { reportId, datasetId?, measures, aggregates, filters, months }──▶
Node Function API ──▶ Postgres stored procedure bi_engine.execute_query(user_id, request jsonb)
                      (JSON → validated, parameterized SQL over pi.fact_savings)
               ◀── { report, dataset, kpis, filterOptions, appliedFilters, rows } ◀──
```

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the step-by-step workflow and [docs/flow-diagram.png](docs/flow-diagram.png) for the flow diagram.

- **Pages:** Sign in → Home → Explore → Savings Invoice (same Home / Explore / report pattern as HPM)
- **Report:** multi-select Market and Program Type filters, saved **datasets**, three KPI tiles, a sortable month table with a totals row, and CSV export
- **Datasets:** a named set of filter values (e.g. `Arizona-CPI` = Market AZ + Program CPI) saved per user, so users pick one instead of setting each filter
- **Sign-in:** username/password; datasets belong to the signed-in user
- **Data sources** (switchable in the report toolbar): **Function API** (default), **JSON file**, **CSV file**, **Upload CSV**. Datasets work with every source; only the API sends them by id.
- **Stack:** React 19, Material UI 9, React Router 7 (hash routing), Vite 8, Node 24, Postgres 16 (`pg`), Vitest. Requires **Node 24** (`.nvmrc`) and **Docker** for the local database.

## Run it

```bash
nvm use                      # Node 24
npm install
cp .env.example .env.local   # optional; defaults work locally

npm run db:up                # start Postgres 16 in Docker (localhost:5432, user/password/db: pi)
npm run db:setup             # (re)create schemas, stored procedure, users, 2,400 fact rows, example datasets
npm run api                  # Function API on http://localhost:7071/api (restarts when server/ changes)
npm run dev                  # second terminal: React app on http://localhost:5173
```

Sign in as **analyst** or **reviewer**, password `Password123!` (or `SEED_PASSWORD`). `analyst` has three example datasets (Arizona-CPI, Southwest-EDC, Big Four States); `reviewer` has one (Texas-All).

Other commands:

```bash
npm test           # unit tests + API/stored-procedure integration tests (skipped if Postgres isn't set up)
npm run build      # static site in dist/
npm run preview    # serve dist/ locally (also proxies /api)
npm run db:down    # stop Postgres (data is kept in the pi-pgdata volume)
```

In dev and preview, Vite proxies `/api` to `http://localhost:7071`, so the browser needs no CORS setup. `dist/` is plain static files with relative paths; set `VITE_API_BASE_URL` to the deployed API URL before building.

## Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_DATA_SOURCE` | `api` | Source selected on first load: `api`, `json` or `csv` |
| `VITE_API_BASE_URL` | `/api` | Function API base URL. `/api` uses the Vite proxy; for a deployed build use e.g. `https://<app>.azurewebsites.net/api` |
| `VITE_API_QUERY_PATH` | `/query` | Query endpoint path |
| `VITE_API_KEY` | – | Sent as `x-functions-key` when set. Don't put secrets in a public build |
| `VITE_API_TIMEOUT_MS` | `30000` | Request timeout |
| `VITE_JSON_URL` / `VITE_CSV_URL` | `data/…` | Static data file locations |
| `VITE_CUSTOMER_NAME` | `Centene` | Fallback customer label (the signed-in user's customer is used when known) |
| `DATABASE_URL` | `postgres://pi:pi@localhost:5432/pi` | Postgres connection for the API and setup script |
| `API_PORT` | `7071` | Function API port |
| `CORS_ORIGIN` | `*` | Allowed origin for direct (non-proxied) browser calls |
| `SEED_PASSWORD` | `Password123!` | Password `npm run db:setup` gives the demo users |

`VITE_*` values are read at build time, so rebuild after changing them.

## Database (`server/db/sql/`)

| File | Contents |
|---|---|
| `01_schema.sql` | Schema `pi`: `customer`, `users`, `user_session`, report catalog (`report`, `kpi_measure`, `query_attribute`), `fact_savings`, `dataset`, `dataset_filter` |
| `02_bi_engine.sql` | Schema `bi_engine`: the `execute_query(user_id, request jsonb) → jsonb` stored procedure |
| `03_catalog.sql` | Savings Invoice catalog rows: measures (`sum(claims_denied)` …) and filter/group attributes |

`npm run db:setup` drops and recreates both schemas, so it also resets datasets. `pi.dataset` is a simplified subset of the Snowflake `DATASET` table (same column names: `dataset_id`, `customer_id`, `name`, `description`, `dataset_status_id`, `copied_from_dataset_id`, `owner_user_id`, `readpolicy_id`, `created_user_id`, `last_modified_user_id`, `created/last_modified/last_accessed_date_time`). Filter values live in `pi.dataset_filter`, one row per selected value, so a filter can hold several values.

**Public datasets (later):** `readpolicy_id = 2` already makes a dataset visible (read-only) to every user of the same customer; listing, reading and querying honour it. The UI and API don't offer a way to set it yet: add `isPublic` to the create/update endpoints and a toggle in the save dialog when needed.

**Adding a measure or filter** is a catalog row in `03_catalog.sql` (plus the column in `fact_savings`), not a code change in the stored procedure.

## Function API

All endpoints except `health` and `auth/login` need `Authorization: Bearer <token>`. Errors are `{ "error": "...", "field"?: "..." }` with status 400 (invalid request), 401 (not signed in), 403, 404 or 409 (duplicate dataset name).

| Method and path | Purpose |
|---|---|
| `POST /api/auth/login` | `{ username, password }` → `{ token, expiresAt, user }` (8-hour session) |
| `POST /api/auth/logout` | End the session |
| `GET /api/auth/me` | Current user |
| `POST /api/query` | Run the report through `bi_engine.execute_query` |
| `GET /api/datasets` | The user's datasets, then public ones |
| `POST /api/datasets` | `{ name, description?, filters: [{ attributeKey, values }] }` → 201 |
| `GET` / `PUT` / `DELETE /api/datasets/:id` | Read / change (`name`, `description`, `filters`) / delete; only the owner can change or delete |
| `GET /api/health` | Database check |

**Query request:**

```json
{
  "reportId": "savings-invoice",
  "datasetId": 1,
  "measures": ["claimsDenied", "grossSavings", "amount"],
  "aggregates": [{ "attributeKey": "month", "grain": "month" }],
  "filters": [{ "attributeKey": "market", "values": ["AZ", "TX"] }],
  "months": 24,
  "debug": false
}
```

- The shape mirrors Core's `executeQuery`, so the report can move onto the HPM BI Engine API later with little change.
- `datasetId` is optional. The stored procedure loads that dataset's filters itself (after checking the user may see it) and ANDs any request `filters` on top. The app sends the id while a saved dataset is unchanged, and plain filters once the user modifies it.
- Several `values` in one filter mean OR (AZ or TX); separate filters are ANDed. An empty filter list means all data.
- The customer always comes from the signed-in user, never from the request.
- `debug: true` adds the generated SQL and its parameters to the response.

**Query response:**

```json
{
  "report": { "id": "savings-invoice", "title": "Savings Invoice", "customer": "Centene", "asOf": "…", "from": "2024-10", "to": "2026-09" },
  "dataset": { "id": 1, "name": "Arizona-CPI" },
  "kpis": [{ "key": "claimsDenied", "label": "Total # Claims Denied", "format": "number", "value": 1083 }],
  "filterOptions": { "market": ["AK", "AL", "…"], "programType": ["CPI", "EDC"] },
  "appliedFilters": [{ "attributeKey": "market", "values": ["AZ"], "source": "dataset" }],
  "rows": [{ "month": "2026-09", "claimsDenied": 44, "grossSavings": 63815.2, "amount": 34641.9 }]
}
```

**SQL safety:** table and column names come only from the catalog tables (quoted with `%I`), aggregate expressions only from `pi.kpi_measure`, and every request value is bound as a parameter. Unknown measures, attributes, grains or out-of-range `months` are rejected with a 400 naming the field.

## CSV format

One row per month, or one row per month × market × program type (the app rolls rows up by month). Header names are matched loosely: case, spaces, `_`, `-` and `#` are ignored.

| Field | Accepted headers (examples) |
|---|---|
| month (required) | `month`, `Month of Transaction`, `trans_date`, `period` |
| market | `market`, `state` |
| programType | `program_type`, `Program Type`, `lob` |
| claimsDenied | `claims_denied`, `Total # Claims Denied` |
| grossSavings | `gross_savings`, `Total Gross Savings` |
| amount | `amount`, `invoice_amount` |

Currency symbols, thousands separators and `(1,000.00)` negatives are handled. Rows without a readable month are skipped.

## Sample data

`public/data/savings-invoice.{json,csv}` hold **synthetic data**, not real figures: 24 months (Oct-2024 to Sep-2026) × 50 markets (US state codes, weighted roughly by population) × 2 program types (EDC, CPI) = 2,400 rows, with growth, seasonality and random variation. Totals will not match the Tableau report. `npm run db:setup` loads the same rows into `pi.fact_savings`. Regenerate with:

```bash
npm run data:generate                      # default seed
node scripts/generate-sample-data.mjs 42   # different seed
npm run db:setup                           # reload the database from the new files
```

Markets, program types, volumes, savings per claim and fee rates are constants at the top of `scripts/generate-sample-data.mjs`.

## Logos

Put the approved files in `public/logos/` as `optum.svg|png` and `centene.svg|png`. Until then the app shows the names as text (the browser console shows a 404 for the missing file). See `public/logos/README.txt`.

## Project layout

```
src/
  config.js                   env settings
  theme.js                    MUI theme and brand colours
  reports.js                  report catalogue for the Explore page
  auth/AuthContext.jsx        sign-in state, token handling
  data/apiClient.js           fetch wrapper: base URL, bearer token, errors, 401 handling
  data/dataService.js         API / JSON / CSV / upload loaders and the query request
  data/datasetsApi.js         dataset CRUD calls and filter conversion
  data/schema.js              normalise, filter, roll up, KPIs (shared by all sources)
  data/csv.js                 CSV parsing (PapaParse)
  components/                 header, logo, KPI tiles, table, toolbar, DatasetBar, SaveDatasetDialog
  pages/                      Login, Home, Explore, SavingsInvoice
server/
  function-api.mjs            node:http host (npm run api)
  routes.js                   HTTP-agnostic route table; Query API -> stored procedure
  auth.js                     scrypt passwords, hashed session tokens
  datasets.js                 dataset service (validation, ownership)
  db/pool.js                  pg pool and transactions
  db/sql/                     schema, stored procedure, catalog
  api.test.js                 integration tests against Postgres
scripts/
  generate-sample-data.mjs    synthetic CSV/JSON
  db-setup.mjs                rebuild and seed the database
docker-compose.yml            local Postgres 16
```

## Moving into the HPM shell later

This is a standalone app. To become an HPM tenant remote, per the Oct 22 and Oct 27 calls, the report page and components move into a remote in PI's own repo. The loader there swaps `dataService.js` for `executeQuery` from `@avrc/ui`; the request shape above already matches it. Sign-in, header, navigation and customer selection then come from the shell, and `bi_engine.execute_query` is replaced by the real BI_Engine stored procedure (Snowflake) behind the same request/response contract.
