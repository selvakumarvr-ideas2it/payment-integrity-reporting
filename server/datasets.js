// Saved datasets: a named set of filters owned by a user.
// Users see their own datasets plus public ones (readpolicy_id = 2) of their customer; only the owner can change one.
import pg from 'pg';
import { withTransaction } from './db/pool.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';

export const READ_POLICY = { PRIVATE: 1, PUBLIC: 2 };
const STATUS_ACTIVE = 1;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const MAX_FILTER_VALUES = 200;
const REPORT_ID = 'savings-invoice';

const SELECT = `SELECT d.dataset_id, d.name, d.description, d.owner_user_id, u.display_name AS owner_name, d.readpolicy_id,
    d.copied_from_dataset_id, d.created_date_time, d.last_modified_date_time, d.last_accessed_date_time,
    coalesce((SELECT jsonb_agg(jsonb_build_object('attributeKey', f.attribute_key, 'values', f.vals) ORDER BY f.attribute_key)
                FROM (SELECT attribute_key, jsonb_agg(value ORDER BY value) AS vals
                        FROM pi.dataset_filter WHERE dataset_id = d.dataset_id GROUP BY attribute_key) f), '[]') AS filters
  FROM pi.dataset d JOIN pi.users u ON u.user_id = d.owner_user_id
  WHERE d.customer_id = $1 AND d.dataset_status_id = ${STATUS_ACTIVE}
    AND (d.owner_user_id = $2 OR d.readpolicy_id = ${READ_POLICY.PUBLIC})`;

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
  filters: r.filters,
});

export async function listDatasets(db, user) {
  const { rows } = await db.query(`${SELECT} ORDER BY d.owner_user_id <> $2, lower(d.name)`, [user.customerId, user.id]);
  return rows.map((r) => toDataset(r, user));
}

export async function getDataset(db, user, id) {
  if (!/^\d{1,9}$/.test(String(id))) throw notFound(`Dataset ${id} not found`);
  const { rows } = await db.query(`${SELECT} AND d.dataset_id = $3`, [user.customerId, user.id, Number(id)]);
  if (!rows[0]) throw notFound(`Dataset ${id} not found`);
  return toDataset(rows[0], user);
}

/** Check filters against the report catalog; values must exist in the customer's data. */
async function validateFilters(db, user, filters) {
  if (!Array.isArray(filters)) throw badRequest('filters must be an array', 'filters');
  const { rows: catalog } = await db.query(
    `SELECT a.attribute_key, a.column_name, r.fact_table FROM pi.query_attribute a JOIN pi.report r USING (report_id)
     WHERE a.report_id = $1 AND a.is_filter`,
    [REPORT_ID],
  );
  const out = [];
  for (const [i, f] of filters.entries()) {
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
  if (!out.length) throw badRequest('Select at least one filter value', 'filters');
  return out;
}

async function validateInput(db, user, input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw badRequest('Name is required', 'name');
    if (name.length > NAME_MAX) throw badRequest(`Name must be at most ${NAME_MAX} characters`, 'name');
    out.name = name;
  }
  if (input.description !== undefined) {
    const description = String(input.description ?? '').trim();
    if (description.length > DESCRIPTION_MAX) throw badRequest(`Description must be at most ${DESCRIPTION_MAX} characters`, 'description');
    out.description = description || null;
  }
  if (!partial || input.filters !== undefined) out.filters = await validateFilters(db, user, input.filters);
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

export async function createDataset(pool, user, input = {}) {
  const { name, description = null, filters } = await validateInput(pool, user, input);
  await assertNameFree(pool, user, name);
  const copiedFrom = input.copiedFromId ? (await getDataset(pool, user, input.copiedFromId)).id : null;
  const id = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO pi.dataset (customer_id, name, description, copied_from_dataset_id, owner_user_id, readpolicy_id,
         created_user_id, last_modified_user_id)
       VALUES ($1, $2, $3, $4, $5, ${READ_POLICY.PRIVATE}, $5, $5) RETURNING dataset_id`,
      [user.customerId, name, description, copiedFrom, user.id],
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
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE pi.dataset SET name = coalesce($1, name),
         description = CASE WHEN $2 THEN $3 ELSE description END,
         last_modified_user_id = $4, last_modified_date_time = now()
       WHERE dataset_id = $5`,
      [changes.name ?? null, 'description' in changes, changes.description ?? null, user.id, existing.id],
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
