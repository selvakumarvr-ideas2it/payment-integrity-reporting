import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  DATASET_STATUS_ACTIVE,
  FILTER_ATTRIBUTES,
  READ_POLICY,
  type DatasetRecord,
  type FilterAttribute,
  type FilterClause,
  type SessionUser,
} from '@/model';
import { db } from './db/client';
import { dataset, datasetFilter, factSavings, users } from './db/schema';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from './http';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const MAX_FILTER_VALUES = 200;

const visibleTo = (user: SessionUser) =>
  and(
    eq(dataset.customerId, user.customerId),
    eq(dataset.datasetStatusId, DATASET_STATUS_ACTIVE),
    or(eq(dataset.ownerUserId, user.id), eq(dataset.readpolicyId, READ_POLICY.PUBLIC)),
  );

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function groupFilters(
  rows: { datasetId: number; attributeKey: string; value: string }[],
): Map<number, FilterClause[]> {
  const byDataset = new Map<number, Map<string, string[]>>();
  for (const row of rows) {
    const attributes = byDataset.get(row.datasetId) ?? new Map<string, string[]>();
    const values = attributes.get(row.attributeKey) ?? [];
    values.push(row.value);
    attributes.set(row.attributeKey, values);
    byDataset.set(row.datasetId, attributes);
  }
  const grouped = new Map<number, FilterClause[]>();
  for (const [datasetId, attributes] of byDataset) {
    grouped.set(
      datasetId,
      [...attributes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([attributeKey, values]) => ({
          attributeKey: attributeKey as FilterAttribute,
          values: [...values].sort((a, b) => a.localeCompare(b)),
        })),
    );
  }
  return grouped;
}

type DatasetRow = {
  datasetId: number;
  name: string;
  description: string | null;
  ownerUserId: number;
  ownerName: string;
  readpolicyId: number;
  copiedFromDatasetId: number | null;
  createdDateTime: Date;
  lastModifiedDateTime: Date;
  lastAccessedDateTime: Date | null;
};

function toRecord(row: DatasetRow, filters: FilterClause[], user: SessionUser): DatasetRecord {
  return {
    id: row.datasetId,
    name: row.name,
    description: row.description ?? '',
    owner: { id: row.ownerUserId, displayName: row.ownerName },
    isOwner: row.ownerUserId === user.id,
    isPublic: row.readpolicyId === READ_POLICY.PUBLIC,
    copiedFromId: row.copiedFromDatasetId,
    createdAt: iso(row.createdDateTime) ?? '',
    updatedAt: iso(row.lastModifiedDateTime) ?? '',
    lastAccessedAt: iso(row.lastAccessedDateTime),
    filters,
  };
}

const datasetSelect = {
  datasetId: dataset.datasetId,
  name: dataset.name,
  description: dataset.description,
  ownerUserId: dataset.ownerUserId,
  ownerName: users.displayName,
  readpolicyId: dataset.readpolicyId,
  copiedFromDatasetId: dataset.copiedFromDatasetId,
  createdDateTime: dataset.createdDateTime,
  lastModifiedDateTime: dataset.lastModifiedDateTime,
  lastAccessedDateTime: dataset.lastAccessedDateTime,
};

async function attachFilters(rows: DatasetRow[], user: SessionUser): Promise<DatasetRecord[]> {
  if (!rows.length) return [];
  const filterRows = await db
    .select({
      datasetId: datasetFilter.datasetId,
      attributeKey: datasetFilter.attributeKey,
      value: datasetFilter.value,
    })
    .from(datasetFilter)
    .where(
      inArray(
        datasetFilter.datasetId,
        rows.map((row) => row.datasetId),
      ),
    )
    .orderBy(asc(datasetFilter.attributeKey), asc(datasetFilter.value));
  const grouped = groupFilters(filterRows);
  return rows.map((row) => toRecord(row, grouped.get(row.datasetId) ?? [], user));
}

export async function listDatasets(user: SessionUser): Promise<DatasetRecord[]> {
  const rows = await db
    .select(datasetSelect)
    .from(dataset)
    .innerJoin(users, eq(dataset.ownerUserId, users.userId))
    .where(visibleTo(user))
    .orderBy(sql`(${dataset.ownerUserId} = ${user.id}) desc`, sql`lower(${dataset.name})`);
  return attachFilters(rows, user);
}

export async function getDataset(user: SessionUser, id: unknown): Promise<DatasetRecord> {
  const datasetId = parseDatasetId(id);
  const rows = await db
    .select(datasetSelect)
    .from(dataset)
    .innerJoin(users, eq(dataset.ownerUserId, users.userId))
    .where(and(visibleTo(user), eq(dataset.datasetId, datasetId)))
    .limit(1);
  if (!rows[0]) throw notFound(`Dataset ${id} not found`);
  const [record] = await attachFilters(rows, user);
  return record;
}

function parseDatasetId(id: unknown): number {
  const value = typeof id === 'number' ? id : typeof id === 'string' && /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  if (!Number.isInteger(value) || value < 1) throw notFound(`Dataset ${String(id)} not found`);
  return value;
}

function columnFor(attributeKey: FilterAttribute) {
  return attributeKey === 'market' ? factSavings.market : factSavings.programType;
}

/** Values must be non-empty strings that exist on this customer's fact rows. */
export async function validateFilters(user: SessionUser, input: unknown): Promise<FilterClause[]> {
  if (!Array.isArray(input)) throw badRequest('filters must be an array', 'filters');
  const out: FilterClause[] = [];
  for (const [index, entry] of input.entries()) {
    const clause = entry as { attributeKey?: unknown; values?: unknown };
    const attributeKey = clause?.attributeKey;
    if (typeof attributeKey !== 'string' || !(attributeKey in FILTER_ATTRIBUTES)) {
      throw badRequest(`Unknown filter attribute '${String(attributeKey)}'`, `filters[${index}].attributeKey`);
    }
    const key = attributeKey as FilterAttribute;
    const values = clause.values ?? [];
    if (!Array.isArray(values)) throw badRequest('Filter values must be non-empty strings', `filters[${index}].values`);
    if (values.some((value) => typeof value !== 'string' || !value.trim())) {
      throw badRequest('Filter values must be non-empty strings', `filters[${index}].values`);
    }
    if (values.length > MAX_FILTER_VALUES) {
      throw badRequest(`At most ${MAX_FILTER_VALUES} values per filter`, `filters[${index}].values`);
    }
    const unique = [...new Set(values.map((value) => value.trim()))];
    if (!unique.length) continue;
    const column = columnFor(key);
    const found = await db
      .selectDistinct({ value: column })
      .from(factSavings)
      .where(and(eq(factSavings.customerId, user.customerId), inArray(column, unique)));
    const known = new Set(found.map((row) => row.value));
    const unknown = unique.filter((value) => !known.has(value));
    if (unknown.length) {
      throw badRequest(`Unknown ${key} value(s): ${unknown.join(', ')}`, `filters[${index}].values`);
    }
    out.push({ attributeKey: key, values: unique });
  }
  if (!out.length) throw badRequest('Select at least one filter value', 'filters');
  return out;
}

async function assertNameFree(user: SessionUser, name: string, exceptId?: number) {
  const rows = await db
    .select({ id: dataset.datasetId })
    .from(dataset)
    .where(
      and(
        eq(dataset.customerId, user.customerId),
        eq(dataset.ownerUserId, user.id),
        eq(dataset.datasetStatusId, DATASET_STATUS_ACTIVE),
        sql`lower(${dataset.name}) = lower(${name})`,
      ),
    );
  if (rows.some((row) => row.id !== exceptId)) throw conflict(`You already have a dataset named '${name}'`, 'name');
}

function readName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw badRequest('Name is required', 'name');
  if (name.length > NAME_MAX) throw badRequest(`Name must be at most ${NAME_MAX} characters`, 'name');
  return name;
}

function readDescription(value: unknown): string | null {
  const description = String(value ?? '').trim();
  if (description.length > DESCRIPTION_MAX) {
    throw badRequest(`Description must be at most ${DESCRIPTION_MAX} characters`, 'description');
  }
  return description || null;
}

async function writeFilters(tx: Pick<typeof db, 'insert' | 'delete'>, datasetId: number, filters: FilterClause[]) {
  await tx.delete(datasetFilter).where(eq(datasetFilter.datasetId, datasetId));
  const rows = filters.flatMap((filter) =>
    filter.values.map((value) => ({ datasetId, attributeKey: filter.attributeKey, value })),
  );
  if (rows.length) await tx.insert(datasetFilter).values(rows);
}

export async function createDataset(user: SessionUser, input: Record<string, unknown> = {}): Promise<DatasetRecord> {
  const name = readName(input.name);
  const description = input.description === undefined ? null : readDescription(input.description);
  const filters = await validateFilters(user, input.filters);
  await assertNameFree(user, name);
  let copiedFrom: number | null = null;
  if (input.copiedFromId !== undefined && input.copiedFromId !== null) {
    copiedFrom = (await getDataset(user, input.copiedFromId)).id;
  }
  let id: number;
  try {
    id = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(dataset)
        .values({
          customerId: user.customerId,
          name,
          description,
          copiedFromDatasetId: copiedFrom,
          ownerUserId: user.id,
          readpolicyId: READ_POLICY.PRIVATE,
          createdUserId: user.id,
          lastModifiedUserId: user.id,
        })
        .returning({ id: dataset.datasetId });
      const datasetId = inserted[0]?.id;
      if (!datasetId) throw new Error('Insert did not return a dataset id');
      await writeFilters(tx, datasetId, filters);
      return datasetId;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`You already have a dataset named '${name}'`, 'name');
    throw error;
  }
  return getDataset(user, id);
}

export async function updateDataset(
  user: SessionUser,
  id: unknown,
  input: Record<string, unknown> = {},
): Promise<DatasetRecord> {
  const existing = await getDataset(user, id);
  if (!existing.isOwner) throw forbidden('Only the owner can change this dataset');
  const changes: { name?: string; description?: string | null; filters?: FilterClause[] } = {};
  if (input.name !== undefined) changes.name = readName(input.name);
  if (input.description !== undefined) changes.description = readDescription(input.description);
  if (input.filters !== undefined) changes.filters = await validateFilters(user, input.filters);
  if (changes.name) await assertNameFree(user, changes.name, existing.id);
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(dataset)
        .set({
          ...(changes.name ? { name: changes.name } : {}),
          ...(input.description !== undefined ? { description: changes.description ?? null } : {}),
          lastModifiedUserId: user.id,
          lastModifiedDateTime: new Date(),
        })
        .where(eq(dataset.datasetId, existing.id));
      if (changes.filters) await writeFilters(tx, existing.id, changes.filters);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`You already have a dataset named '${changes.name}'`, 'name');
    throw error;
  }
  return getDataset(user, existing.id);
}

export async function deleteDataset(user: SessionUser, id: unknown): Promise<void> {
  const existing = await getDataset(user, id);
  if (!existing.isOwner) throw forbidden('Only the owner can delete this dataset');
  await db.delete(dataset).where(eq(dataset.datasetId, existing.id));
}

export async function markDatasetAccessed(datasetId: number) {
  await db.update(dataset).set({ lastAccessedDateTime: new Date() }).where(eq(dataset.datasetId, datasetId));
}
