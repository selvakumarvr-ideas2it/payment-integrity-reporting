// Query API: Postgres bi_engine.execute_query, or Snowflake PI.BI_ENGINE.EXECUTE_QUERY.
// Sign-in, datasets and the report catalog stay in Postgres either way.
import { getDataset } from './datasets.js';
import { ApiError, fromPgError, notFound } from './errors.js';

export const DEFAULT_MEASURES = ['claimsDenied', 'grossSavings', 'amount'];
export const FILTER_ATTRIBUTES = ['market', 'programType'];
const DEFAULT_REPORT_ID = 'savings-invoice';
const ENGINE_HTTP = { INVALID_REQUEST: 400, NOT_FOUND: 404, FORBIDDEN: 403 };

export function createPostgresExecuteQuery(pool) {
  return async function executeQuery(user, request) {
    try {
      const { rows } = await pool.query('SELECT bi_engine.execute_query($1, $2::jsonb) AS result', [
        user.id,
        JSON.stringify(request ?? {}),
      ]);
      return rows[0].result;
    } catch (e) {
      throw fromPgError(e);
    }
  };
}

/** Map a Snowflake engine error object onto an HTTP ApiError. Connection failures stay 500. */
export function engineError(result) {
  if (!result || result.status !== 'ERROR') return null;
  const status = ENGINE_HTTP[result.code] || 500;
  const message = status === 500 ? 'Internal server error' : result.message || 'Query failed';
  return new ApiError(status, message, result.field || undefined);
}

export function kpiFormat(formatString) {
  return String(formatString || '').includes('$') ? 'currency' : 'number';
}

export function mapKpis(engineResult) {
  const row = engineResult.rows?.[0] ?? {};
  return (engineResult.columns || [])
    .filter((c) => c.kind === 'measure')
    .map((c) => ({
      key: c.name,
      label: c.description || c.name,
      format: kpiFormat(c.format),
      value: Number(row[c.name] ?? 0),
    }));
}

export function mapSnowflakeToReport({ grid, kpis, user, dataset, report }) {
  const months = (grid.rows || []).map((r) => r.month).filter(Boolean).sort();
  return {
    report: {
      id: report.id,
      title: report.title,
      customer: user.customer,
      from: months[0] || null,
      to: months[months.length - 1] || null,
    },
    dataset: dataset ? { id: dataset.id, name: dataset.name } : null,
    kpis: mapKpis(kpis),
    filterOptions: {
      market: grid.attributeValues?.market ?? [],
      programType: grid.attributeValues?.programType ?? [],
    },
    appliedFilters: grid.appliedFilters ?? [],
    rows: grid.rows ?? [],
  };
}

/**
 * Browser fields that the engine must never see: customerId / lineOfBusinessId come from the
 * signed-in user, and debug would leak generated SQL.
 */
export function buildSnowflakePayloads(user, request, { dataset, lineOfBusinessId }) {
  const measures = request?.measures?.length ? request.measures : DEFAULT_MEASURES;
  const filters = [...(dataset?.filters ?? []), ...(Array.isArray(request?.filters) ? request.filters : [])];
  const base = {
    customerId: user.customerId,
    lineOfBusinessId,
    ...(dataset ? { datasetId: dataset.id } : {}),
    measures,
    filters,
    months: request?.months ?? 24,
  };
  const aggregates = request?.aggregates?.length ? request.aggregates : [{ attributeKey: 'month', grain: 'month' }];
  return {
    grid: { ...base, aggregates, attributeValues: FILTER_ATTRIBUTES },
    kpis: { ...base },
  };
}

export function createSnowflakeExecuteQuery({ pool, callExecuteQuery, lineOfBusinessId = 1 }) {
  return async function executeQuery(user, request, { clientIp } = {}) {
    const reportId = request?.reportId || DEFAULT_REPORT_ID;
    const { rows: reportRows } = await pool.query('SELECT report_id, title FROM pi.report WHERE report_id = $1', [reportId]);
    if (!reportRows[0]) throw notFound(`Unknown report '${reportId}'`);
    const report = { id: reportRows[0].report_id, title: reportRows[0].title };

    let dataset = null;
    if (request?.datasetId != null && request.datasetId !== '') {
      dataset = await getDataset(pool, user, request.datasetId);
      await pool.query('UPDATE pi.dataset SET last_accessed_date_time = now() WHERE dataset_id = $1', [dataset.id]);
    }

    const payloads = buildSnowflakePayloads(user, request, { dataset, lineOfBusinessId });
    const ctx = { userId: user.id, clientIp };
    const [grid, kpis] = await Promise.all([
      callExecuteQuery(payloads.grid, ctx),
      callExecuteQuery(payloads.kpis, ctx),
    ]);

    const err = engineError(grid) || engineError(kpis);
    if (err) throw err;

    return mapSnowflakeToReport({ grid, kpis, user, dataset, report });
  };
}

export function createExecuteQuery({ pool, snowflake, backend = 'postgres', lineOfBusinessId }) {
  if (backend === 'snowflake') {
    if (!snowflake?.callExecuteQuery) throw new Error('Snowflake client is not configured');
    return createSnowflakeExecuteQuery({
      pool,
      callExecuteQuery: snowflake.callExecuteQuery.bind(snowflake),
      lineOfBusinessId: Number(lineOfBusinessId || process.env.LINE_OF_BUSINESS_ID || 1),
    });
  }
  return createPostgresExecuteQuery(pool);
}
