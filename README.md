# Payment Integrity Reporting

React reporting app for the Payment Integrity (PI) **Savings Invoice** report: a Centene view of prepay savings by month, styled after the Health Plan Manager shell.

```
React ──GET datasets / customer──▶ App API (sibling repo payment-integrity-api) :7071
React ──POST /api/v1/clients/{id}/financial-impact──▶ Function API (Azure)
Function API ──CALL PI.BI_ENGINE.EXECUTE_QUERY──▶ Snowflake
         ◀── { report, dataset, kpis, filterOptions, rows } ◀──
```

See [docs/WORKFLOW.md](docs/WORKFLOW.md). Snowflake scripts: [docs/BI_ENGINE_SNOWFLAKE.md](docs/BI_ENGINE_SNOWFLAKE.md). Auth and datasets are in the sibling **payment-integrity-api** project (`http://localhost:7071`). Report queries go to the Azure Function App.

- **Pages:** Sign in → Home → Explore → Savings Invoice (same Home / Explore / report pattern as HPM)
- **Report:** multi-select Market and Program Type filters, saved **datasets**, three KPI tiles, a sortable month table with a totals row, and CSV export
- **Datasets:** a named set of filter values (e.g. `Arizona-CPI` = Market AZ + Program CPI) saved per user, so users pick one instead of setting each filter
- **Sign-in:** username/password; datasets belong to the signed-in user
- **Data sources** (switchable in the report toolbar): **Function API** (default), **JSON file**, **CSV file**, **Upload CSV**. Datasets work with every source; only the API sends them by id.
- **Stack:** React 19, Material UI 9, React Router 7 (hash routing), Vite 8, Node 24, Vitest. Requires **Node 24** (`.nvmrc`). Sign-in and datasets come from **payment-integrity-api**. The Function API tab calls the Azure Function App.

## Run it

In **payment-integrity-api** (sibling folder):

```bash
nvm use && npm install
cp .env.example .env.local
npm run db:up && npm run db:setup
npm start                    # App API on :7071
```

In this repo:

```bash
nvm use                      # Node 24
npm install
cp .env.example .env.local   # optional; defaults work locally
npm run dev                  # React app on :5173 (proxies /api → :7071, /api/v1 → Azure)
```

Sign in as **analyst** or **reviewer**, password `Password123!` (or `SEED_PASSWORD` in the API project). `analyst` has three example datasets (Arizona-CPI, Southwest-EDC, Big Four States); `reviewer` has one (Texas-All).

Other commands:

```bash
npm test           # unit tests
npm run build      # static site in dist/
npm run preview    # serve dist/ locally (also proxies /api)
```

In dev and preview, Vite proxies `/api/v1` to the Function App and other `/api` paths to `:7071`. `dist/` is plain static files; set `VITE_API_BASE_URL` and `VITE_QUERY_API_BASE_URL` before building a deployed app.

## Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_DATA_SOURCE` | `api` | Source selected on first load: `api`, `json` or `csv` |
| `VITE_API_BASE_URL` | `/api` | App API (auth, datasets). `/api` uses the Vite proxy to `:7071` |
| `VITE_QUERY_API_BASE_URL` | Azure Function App | Function App origin; path `/api/v1/clients/{id}/financial-impact` is built in code |
| `VITE_API_KEY` / `VITE_QUERY_API_KEY` | – | Sent as `x-functions-key`. Don't put secrets in a public build |
| `VITE_API_TIMEOUT_MS` | `60000` | Request timeout (60s so a Snowflake warehouse resume can finish) |
| `VITE_LINE_OF_BUSINESS_ID` | `1` | Sent on every Function API payload (must match `snowflake/04_seed_savings_invoice.sql`) |
| `VITE_JSON_URL` / `VITE_CSV_URL` | `data/…` | Static data file locations |
| `VITE_CUSTOMER_NAME` | `Centene` | Fallback customer label (the signed-in user's customer is used when known) |
| `API_PROXY_TARGET` | `http://localhost:7071` | Vite proxy target for `/api` (the App API) |
`VITE_*` values are read at build time, so rebuild after changing them.

Postgres, dataset SQL and the App API live in **payment-integrity-api**. See that project's README for `DATABASE_URL`, `API_PORT` and seed users.

## Query API (Azure Function App)

Snowflake only. Start that service on its own (`npm start` in its repo). The React Function API tab POSTs here. This reporting app does not start or own that process.

**Query request** (React fills `customerId` from the signed-in App DB user):

```json
{
  "reportId": "savings-invoice",
  "customerId": 1,
  "lineOfBusinessId": 1,
  "customer": "Centene",
  "datasetId": 1,
  "dataset": { "id": 1, "name": "Arizona-CPI" },
  "measures": ["claimsDenied", "grossSavings", "amount"],
  "aggregates": [{ "attributeKey": "month", "grain": "month" }],
  "filters": [{ "attributeKey": "market", "values": ["AZ", "TX"] }],
  "months": 24
}
```

- `customerId` is required. Production should overwrite it from APIM / IdP JWT so the browser cannot pick another customer.
- Several `values` in one filter mean OR (AZ or TX); separate filters are ANDed. An empty filter list means all data.
- `debug` from the browser is dropped.

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

`public/data/savings-invoice.{json,csv}` hold **synthetic data**, not real figures: 24 months (Oct-2024 to Sep-2026) × 50 markets (US state codes, weighted roughly by population) × 2 program types (EDC, CPI) = 2,400 rows, with growth, seasonality and random variation. Totals will not match the Tableau report. The App API seeds Postgres from its own copy of this JSON. Regenerate the files with:

```bash
npm run data:generate                      # default seed
node scripts/generate-sample-data.mjs 42   # different seed
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
  components/                 header, logo, KPI tiles, table, toolbar, DatasetBar, DatasetWizard
  pages/                      Login, Home, Explore, SavingsInvoice
scripts/
  generate-sample-data.mjs    synthetic CSV/JSON
```

App API (auth, datasets, Postgres): sibling repo `payment-integrity-api`.

## Moving into the HPM shell later

This is a standalone app. To become an HPM tenant remote, per the Oct 22 and Oct 27 calls, the report page and components move into a remote in PI's own repo. The loader there swaps `dataService.js` for `executeQuery` from `@avrc/ui`; the request shape above already matches it. Sign-in, header, navigation and customer selection then come from the shell, and `bi_engine.execute_query` is replaced by the real BI_Engine stored procedure (Snowflake) behind the same request/response contract.
