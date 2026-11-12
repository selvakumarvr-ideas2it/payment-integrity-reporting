// Datasets: HPM-style time-period configurations owned by a user, plus optional filters.
// Users see their own datasets plus public ones (readpolicy_id = 2) of their customer; only the owner can change one.
import pg from 'pg';
import { withTransaction } from './db/pool.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { generateDatasetName, periodMonths } from './datasetPeriods.js';

export const READ_POLICY = { PRIVATE: 1, PUBLIC: 2 };
const STATUS_ACTIVE = 1;
const NAME_MAX = 1000;
const DESCRIPTION_MAX = 1000;
const MAX_FILTER_VALUES = 200;
const REPORT_ID = 'savings-invoice';

const PERIOD_COLUMNS = `
    d.lineofbusiness_id, d.is_norm, d.is_default_template,
    d.current_period_months, d.prior_period_months, d.prior_prior_period_months,
    d.current_service_start_date, d.current_service_end_date,
    d.prior_service_start_date, d.prior_service_end_date,
    d.prior_prior_service_start_date, d.prior_prior_service_end_date,
    d.current_payment_start_date, d.current_payment_end_date,
    d.prior_payment_start_date, d.prior_payment_end_date,
    d.prior_prior_payment_start_date, d.prior_prior_payment_end_date,
    d.current_enrollment_start_date, d.current_enrollment_end_date,
    d.prior_enrollment_start_date, d.prior_enrollment_end_date,
    d.prior_prior_enrollment_start_date, d.prior_prior_enrollment_end_date,
    d.continuously_enrolled_start_date, d.continuously_enrolled_end_date,
    d.use_paid_only, d.include_continuously_enrolled`;

const SELECT = `SELECT d.dataset_id, d.name, d.description, d.owner_user_id, u.display_name AS owner_name, d.readpolicy_id,
    d.copied_from_dataset_id, d.created_date_time, d.last_modified_date_time, d.last_accessed_date_time,
    ${PERIOD_COLUMNS},
    coalesce((SELECT jsonb_agg(jsonb_build_object('attributeKey', f.attribute_key, 'values', f.vals) ORDER BY f.attribute_key)
                FROM (SELECT attribute_key, jsonb_agg(value ORDER BY value) AS vals
                        FROM pi.dataset_filter WHERE dataset_id = d.dataset_id GROUP BY attribute_key) f), '[]') AS filters
  FROM pi.dataset d JOIN pi.users u ON u.user_id = d.owner_user_id
  WHERE d.customer_id = $1 AND d.dataset_status_id = ${STATUS_ACTIVE}
    AND (d.owner_user_id = $2 OR d.readpolicy_id = ${READ_POLICY.PUBLIC})`;

const isoDate = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

const range = (start, end) => ({ start: isoDate(start), end: isoDate(end) });

function periodsFromRow(r) {
  return {
    current: {
      service: range(r.current_service_start_date, r.current_service_end_date),
      payment: range(r.current_payment_start_date, r.current_payment_end_date),
      enrollment: range(r.current_enrollment_start_date, r.current_enrollment_end_date),
    },
    prior: {
      service: range(r.prior_service_start_date, r.prior_service_end_date),
      payment: range(r.prior_payment_start_date, r.prior_payment_end_date),
      enrollment: range(r.prior_enrollment_start_date, r.prior_enrollment_end_date),
    },
    priorPrior: {
      service: range(r.prior_prior_service_start_date, r.prior_prior_service_end_date),
      payment: range(r.prior_prior_payment_start_date, r.prior_prior_payment_end_date),
      enrollment: range(r.prior_prior_enrollment_start_date, r.prior_prior_enrollment_end_date),
    },
    continuouslyEnrolled: range(r.continuously_enrolled_start_date, r.continuously_enrolled_end_date),
    usePaidOnly: Boolean(r.use_paid_only),
    includeContinuouslyEnrolled: r.include_continuously_enrolled !== false,
    included: {
      current: true,
      prior: Boolean(r.prior_service_start_date),
      priorPrior: Boolean(r.prior_prior_service_start_date),
    },
    isNorm: Boolean(r.is_norm),
    isDefaultTemplate: Boolean(r.is_default_template),
  };
}

const toDataset = (r, user) => ({
  id: r.dataset_id,
  name: r.name,
  description: r.description || '',
  owner: { id: r.owner_user_id, displayName: r.owner_name },
  isOwner: r.owner_user_id === user.id,
  isPublic: r.readpolicy_id === READ_POLICY.PUBLIC,
  copiedFromId: r.copied_from_dataset_id,
  createdAt: r.created_date_time,
  updatedAt: r.last_modified_date_time,
  lastAccessedAt: r.last_accessed_date_time,
  lineOfBusinessId: r.lineofbusiness_id,
  filters: r.filters,
  periods: periodsFromRow(r),
});

export async function listDatasets(db, user) {
  const { rows } = await db.query(`${SELECT} ORDER BY d.owner_user_id <> $2, d.last_accessed_date_time DESC NULLS LAST, lower(d.name)`, [
    user.customerId,
    user.id,
  ]);
  return rows.map((r) => toDataset(r, user));
}

export async function getDataset(db, user, id) {
  if (!/^\d{1,9}$/.test(String(id))) throw notFound(`Dataset ${id} not found`);
  const { rows } = await db.query(`${SELECT} AND d.dataset_id = $3`, [user.customerId, user.id, Number(id)]);
  if (!rows[0]) throw notFound(`Dataset ${id} not found`);
  return toDataset(rows[0], user);
}

function parseDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`Invalid date`, field);
  return s;
}

function parseRange(rangeObj, field) {
  const start = parseDate(rangeObj?.start, `${field}.start`);
  const end = parseDate(rangeObj?.end, `${field}.end`);
  if (Boolean(start) !== Boolean(end)) throw badRequest('Start and end dates are both required', field);
  if (start && end && start > end) throw badRequest('Start date must be on or before end date', field);
  return { start, end };
}

function validatePeriods(input) {
  if (!input || typeof input !== 'object') throw badRequest('periods is required', 'periods');
  const currentService = parseRange(input.current?.service, 'periods.current.service');
  if (!currentService.start) throw badRequest('Current period service dates are required', 'periods.current.service');
  const bucket = (src, prefix) => ({
    service: parseRange(src?.service, `${prefix}.service`),
    payment: parseRange(src?.payment, `${prefix}.payment`),
    enrollment: parseRange(src?.enrollment, `${prefix}.enrollment`),
  });
  const current = {
    ...bucket(input.current, 'periods.current'),
    service: currentService,
  };
  const included = input.included || { current: true, prior: true, priorPrior: false };
  return {
    current,
    prior: included.prior === false ? bucket({}, 'periods.prior') : bucket(input.prior, 'periods.prior'),
    priorPrior: included.priorPrior ? bucket(input.priorPrior, 'periods.priorPrior') : bucket({}, 'periods.priorPrior'),
    continuouslyEnrolled:
      input.includeContinuouslyEnrolled === false ? { start: null, end: null } : parseRange(input.continuouslyEnrolled, 'periods.continuouslyEnrolled'),
    usePaidOnly: Boolean(input.usePaidOnly),
    includeContinuouslyEnrolled: input.includeContinuouslyEnrolled !== false,
    isNorm: Boolean(input.isNorm),
    isDefaultTemplate: Boolean(input.isDefaultTemplate),
    included: { current: true, prior: included.prior !== false, priorPrior: Boolean(included.priorPrior) },
  };
}

function periodRow(p) {
  const d = (b, key) => [b?.[key]?.start ?? null, b?.[key]?.end ?? null];
  return {
    lineofbusiness_id: 1,
    is_norm: p.isNorm,
    is_default_template: p.isDefaultTemplate,
    current_period_months: periodMonths(p.current.service),
    prior_period_months: periodMonths(p.prior.service),
    prior_prior_period_months: periodMonths(p.priorPrior.service),
    current_service_start_date: p.current.service.start,
    current_service_end_date: p.current.service.end,
    prior_service_start_date: p.prior.service.start,
    prior_service_end_date: p.prior.service.end,
    prior_prior_service_start_date: p.priorPrior.service.start,
    prior_prior_service_end_date: p.priorPrior.service.end,
    current_payment_start_date: p.current.payment.start,
    current_payment_end_date: p.current.payment.end,
    prior_payment_start_date: p.prior.payment.start,
    prior_payment_end_date: p.prior.payment.end,
    prior_prior_payment_start_date: p.priorPrior.payment.start,
    prior_prior_payment_end_date: p.priorPrior.payment.end,
    current_enrollment_start_date: p.current.enrollment.start,
    current_enrollment_end_date: p.current.enrollment.end,
    prior_enrollment_start_date: p.prior.enrollment.start,
    prior_enrollment_end_date: p.prior.enrollment.end,
    prior_prior_enrollment_start_date: p.priorPrior.enrollment.start,
    prior_prior_enrollment_end_date: p.priorPrior.enrollment.end,
    continuously_enrolled_start_date: p.continuouslyEnrolled.start,
    continuously_enrolled_end_date: p.continuouslyEnrolled.end,
    use_paid_only: p.usePaidOnly,
    include_continuously_enrolled: p.includeContinuouslyEnrolled,
  };
}

/** Check filters against the report catalog; values must exist in the customer's data. Empty is allowed. */
async function validateFilters(db, user, filters) {
  if (filters === undefined || filters === null) return [];
  if (!Array.isArray(filters)) throw badRequest('filters must be an array', 'filters');
  const { rows: catalog } = await db.query(
    `SELECT a.attribute_key, a.column_name, r.fact_table FROM pi.query_attribute a JOIN pi.report r USING (report_id)
     WHERE a.report_id = $1 AND a.is_filter AND a.attribute_key <> 'month'`,
    [REPORT_ID],
  );
  const out = [];
  for (const [i, f] of filters.entries()) {
    if (f?.attributeKey === 'month') continue;
    const attr = catalog.find((a) => a.attribute_key === f?.attributeKey);
    if (!attr) throw badRequest(`Unknown filter attribute '${f?.attributeKey}'`, `filters[${i}].attributeKey`);
    const values = f.values ?? [];
    if (!Array.isArray(values) || values.some((v) => typeof v !== 'string' || !v.trim()))
      throw badRequest('Filter values must be non-empty strings', `filters[${i}].values`);
    if (values.length > MAX_FILTER_VALUES) throw badRequest(`At most ${MAX_FILTER_VALUES} values per filter`, `filters[${i}].values`);
    const unique = [...new Set(values.map((v) => v.trim()))];
    if (!unique.length) continue;
    const col = pg.escapeIdentifier(attr.column_name);
    const { rows } = await db.query(
      `SELECT DISTINCT ${col} AS v FROM pi.${pg.escapeIdentifier(attr.fact_table)} WHERE customer_id = $1 AND ${col} = ANY($2)`,
      [user.customerId, unique],
    );
    const known = new Set(rows.map((r) => r.v));
    const unknown = unique.filter((v) => !known.has(v));
    if (unknown.length) throw badRequest(`Unknown ${attr.attribute_key} value(s): ${unknown.join(', ')}`, `filters[${i}].values`);
    out.push({ attributeKey: attr.attribute_key, values: unique });
  }
  return out;
}

async function validateInput(db, user, input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.periods !== undefined) out.periods = validatePeriods(input.periods);
  if (!partial || input.name !== undefined) {
    const generated = out.periods ? generateDatasetName(out.periods) : '';
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : generated;
    if (!name) throw badRequest('Name is required', 'name');
    if (name.length > NAME_MAX) throw badRequest(`Name must be at most ${NAME_MAX} characters`, 'name');
    out.name = name;
  }
  if (input.description !== undefined) {
    const description = String(input.description ?? '').trim();
    if (description.length > DESCRIPTION_MAX) throw badRequest(`Description must be at most ${DESCRIPTION_MAX} characters`, 'description');
    out.description = description || null;
  }
  if (!partial || input.filters !== undefined) out.filters = await validateFilters(db, user, input.filters ?? []);
  return out;
}

async function assertNameFree(db, user, name, exceptId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM pi.dataset WHERE customer_id = $1 AND owner_user_id = $2 AND lower(name) = lower($3)
       AND dataset_status_id = ${STATUS_ACTIVE} AND dataset_id IS DISTINCT FROM $4`,
    [user.customerId, user.id, name, exceptId],
  );
  if (rows.length) throw conflict(`You already have a dataset named '${name}'`, 'name');
}

async function writeFilters(client, datasetId, filters) {
  await client.query('DELETE FROM pi.dataset_filter WHERE dataset_id = $1', [datasetId]);
  for (const f of filters)
    await client.query(
      'INSERT INTO pi.dataset_filter (dataset_id, attribute_key, value) SELECT $1, $2, unnest($3::text[])',
      [datasetId, f.attributeKey, f.values],
    );
}

const PERIOD_INSERT_COLS = [
  'lineofbusiness_id',
  'is_norm',
  'is_default_template',
  'current_period_months',
  'prior_period_months',
  'prior_prior_period_months',
  'current_service_start_date',
  'current_service_end_date',
  'prior_service_start_date',
  'prior_service_end_date',
  'prior_prior_service_start_date',
  'prior_prior_service_end_date',
  'current_payment_start_date',
  'current_payment_end_date',
  'prior_payment_start_date',
  'prior_payment_end_date',
  'prior_prior_payment_start_date',
  'prior_prior_payment_end_date',
  'current_enrollment_start_date',
  'current_enrollment_end_date',
  'prior_enrollment_start_date',
  'prior_enrollment_end_date',
  'prior_prior_enrollment_start_date',
  'prior_prior_enrollment_end_date',
  'continuously_enrolled_start_date',
  'continuously_enrolled_end_date',
  'use_paid_only',
  'include_continuously_enrolled',
];

export async function createDataset(pool, user, input = {}) {
  const { name, description = null, filters = [], periods } = await validateInput(pool, user, input);
  await assertNameFree(pool, user, name);
  const copiedFrom = input.copiedFromId ? (await getDataset(pool, user, input.copiedFromId)).id : null;
  const row = periodRow(periods);
  const id = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO pi.dataset (customer_id, name, description, copied_from_dataset_id, owner_user_id, readpolicy_id,
         created_user_id, last_modified_user_id, ${PERIOD_INSERT_COLS.join(', ')})
       VALUES ($1, $2, $3, $4, $5, ${READ_POLICY.PRIVATE}, $5, $5, ${PERIOD_INSERT_COLS.map((_, i) => `$${i + 6}`).join(', ')})
       RETURNING dataset_id`,
      [user.customerId, name, description, copiedFrom, user.id, ...PERIOD_INSERT_COLS.map((c) => row[c])],
    );
    await writeFilters(client, rows[0].dataset_id, filters);
    return rows[0].dataset_id;
  });
  return getDataset(pool, user, id);
}

export async function updateDataset(pool, user, id, input = {}) {
  const existing = await getDataset(pool, user, id);
  if (!existing.isOwner) throw forbidden('Only the owner can change this dataset');
  const changes = await validateInput(pool, user, input, { partial: true });
  if (changes.name) await assertNameFree(pool, user, changes.name, existing.id);
  const row = changes.periods ? periodRow(changes.periods) : null;
  await withTransaction(pool, async (client) => {
    const periodSet = row ? PERIOD_INSERT_COLS.map((c, i) => `${c} = $${i + 6}`).join(', ') : '';
    await client.query(
      `UPDATE pi.dataset SET name = coalesce($1, name),
         description = CASE WHEN $2 THEN $3 ELSE description END,
         last_modified_user_id = $4, last_modified_date_time = now()
         ${periodSet ? `, ${periodSet}` : ''}
       WHERE dataset_id = $5`,
      [
        changes.name ?? null,
        'description' in changes,
        changes.description ?? null,
        user.id,
        existing.id,
        ...(row ? PERIOD_INSERT_COLS.map((c) => row[c]) : []),
      ],
    );
    if (changes.filters) await writeFilters(client, existing.id, changes.filters);
  });
  return getDataset(pool, user, existing.id);
}

export async function deleteDataset(pool, user, id) {
  const existing = await getDataset(pool, user, id);
  if (!existing.isOwner) throw forbidden('Only the owner can delete this dataset');
  await pool.query('DELETE FROM pi.dataset WHERE dataset_id = $1', [existing.id]);
}
