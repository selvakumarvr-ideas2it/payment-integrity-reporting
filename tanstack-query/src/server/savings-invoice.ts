import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  FILTER_ATTRIBUTES,
  MEASURES,
  REPORT,
  type AppliedFilter,
  type FilterAttribute,
  type FilterClause,
  type MeasureKey,
  type SavingsInvoiceResponse,
  type SessionUser,
} from '@/model';
import { db } from './db/client';
import { factSavings } from './db/schema';
import { getDataset, markDatasetAccessed } from './datasets';
import { badRequest } from './http';

const MEASURE_COLUMNS = {
  claimsDenied: factSavings.claimsDenied,
  grossSavings: factSavings.grossSavings,
  amount: factSavings.amount,
} as const;

const FILTER_COLUMNS = {
  market: factSavings.market,
  programType: factSavings.programType,
} as const;

const DEFAULT_MEASURES = Object.keys(MEASURES) as MeasureKey[];
const MAX_FILTER_VALUES = 200;

export type ParsedReportRequest = {
  measures: MeasureKey[];
  months: number;
  datasetId?: number;
  filters: FilterClause[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject unknown report, measure, attribute, grain, and months before any query runs. */
export function parseSavingsInvoiceRequest(body: unknown): ParsedReportRequest {
  if (!isRecord(body)) throw badRequest('Request body must be a JSON object');
  if (body.reportId !== REPORT.id) throw badRequest('Unknown report', 'reportId');

  let measures = DEFAULT_MEASURES;
  if (body.measures !== undefined) {
    if (!Array.isArray(body.measures) || body.measures.length === 0) {
      throw badRequest('measures must be a non-empty array', 'measures');
    }
    const seen = new Set<MeasureKey>();
    measures = body.measures.map((measure, index) => {
      if (typeof measure !== 'string' || !(measure in MEASURES)) {
        throw badRequest(`Unknown measure '${String(measure)}'`, `measures[${index}]`);
      }
      return measure as MeasureKey;
    });
    measures = measures.filter((measure) => (seen.has(measure) ? false : (seen.add(measure), true)));
  }

  if (body.aggregates !== undefined) {
    if (!Array.isArray(body.aggregates) || body.aggregates.length !== 1 || !isRecord(body.aggregates[0])) {
      throw badRequest('aggregates accept only month/month', 'aggregates');
    }
    const aggregate = body.aggregates[0];
    if (aggregate.attributeKey !== 'month') throw badRequest('Unknown aggregate attribute', 'aggregates[0].attributeKey');
    if (aggregate.grain !== 'month') throw badRequest('Unknown grain', 'aggregates[0].grain');
  }

  let months = 24;
  if (body.months !== undefined) {
    if (typeof body.months !== 'number' || !Number.isInteger(body.months) || body.months < 1 || body.months > 60) {
      throw badRequest('months must be an integer from 1 to 60', 'months');
    }
    months = body.months;
  }

  let datasetId: number | undefined;
  if (body.datasetId !== undefined && body.datasetId !== null) {
    if (typeof body.datasetId !== 'number' || !Number.isInteger(body.datasetId) || body.datasetId < 1) {
      throw badRequest('datasetId must be a positive integer', 'datasetId');
    }
    datasetId = body.datasetId;
  }

  return { measures, months, datasetId, filters: parseRequestFilters(body.filters) };
}

function parseRequestFilters(input: unknown): FilterClause[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw badRequest('filters must be an array', 'filters');
  const filters: FilterClause[] = [];
  for (const [index, entry] of input.entries()) {
    if (!isRecord(entry)) throw badRequest('Filter must be an object', `filters[${index}]`);
    const attributeKey = entry.attributeKey;
    if (typeof attributeKey !== 'string' || !(attributeKey in FILTER_ATTRIBUTES)) {
      throw badRequest(`Unknown filter attribute '${String(attributeKey)}'`, `filters[${index}].attributeKey`);
    }
    const values = entry.values ?? [];
    if (!Array.isArray(values)) throw badRequest('Filter values must be non-empty strings', `filters[${index}].values`);
    if (values.length > MAX_FILTER_VALUES) {
      throw badRequest(`At most ${MAX_FILTER_VALUES} values per filter`, `filters[${index}].values`);
    }
    if (values.some((value) => typeof value !== 'string' || !value.trim())) {
      throw badRequest('Filter values must be non-empty strings', `filters[${index}].values`);
    }
    const unique = [...new Set(values.map((value) => value.trim()))];
    if (unique.length) filters.push({ attributeKey: attributeKey as FilterAttribute, values: unique });
  }
  return filters;
}

export function shiftMonth(yyyymm: string, delta: number): string {
  const [year, month] = yyyymm.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function round2(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(2));
}

function sumColumn(column: (typeof MEASURE_COLUMNS)[MeasureKey]) {
  return sql<string>`round(coalesce(sum(${column}), 0)::numeric, 2)`;
}

function predicatesFor(filters: FilterClause[]): SQL[] {
  return filters
    .filter((filter) => filter.values.length > 0)
    .map((filter) => inArray(FILTER_COLUMNS[filter.attributeKey], filter.values));
}

/**
 * The only report query. Fixed columns on pi.fact_savings.
 * customer_id always comes from the session, never from the request body.
 */
export async function runSavingsInvoice(user: SessionUser, body: unknown): Promise<SavingsInvoiceResponse> {
  const request = parseSavingsInvoiceRequest(body);
  const datasetRecord = request.datasetId === undefined ? null : await getDataset(user, request.datasetId);
  if (datasetRecord) await markDatasetAccessed(datasetRecord.id);

  const datasetFilters = datasetRecord?.filters ?? [];
  const appliedFilters: AppliedFilter[] = [
    ...datasetFilters.map((filter) => ({ ...filter, source: 'dataset' as const })),
    ...request.filters.map((filter) => ({ ...filter, source: 'request' as const })),
  ];

  const [maxRow] = await db
    .select({ maxMonth: sql<string | null>`max(${factSavings.month})` })
    .from(factSavings)
    .where(eq(factSavings.customerId, user.customerId));
  const to = maxRow?.maxMonth?.trim() || null;
  const from = to ? shiftMonth(to, -(request.months - 1)) : null;

  const window: SQL[] = [eq(factSavings.customerId, user.customerId)];
  if (from && to) {
    window.push(gte(factSavings.month, from), lte(factSavings.month, to));
  }
  const where = and(...window, ...predicatesFor(datasetFilters), ...predicatesFor(request.filters));

  const [monthRows, totals, optionRows] = await Promise.all([
    db
      .select({
        month: factSavings.month,
        claimsDenied: sumColumn(factSavings.claimsDenied),
        grossSavings: sumColumn(factSavings.grossSavings),
        amount: sumColumn(factSavings.amount),
      })
      .from(factSavings)
      .where(where)
      .groupBy(factSavings.month)
      .orderBy(desc(factSavings.month)),
    db
      .select({
        claimsDenied: sumColumn(factSavings.claimsDenied),
        grossSavings: sumColumn(factSavings.grossSavings),
        amount: sumColumn(factSavings.amount),
      })
      .from(factSavings)
      .where(where),
    db
      .selectDistinct({ market: factSavings.market, programType: factSavings.programType })
      .from(factSavings)
      .where(eq(factSavings.customerId, user.customerId)),
  ]);

  const total = totals[0];
  const markets = [...new Set(optionRows.map((row) => row.market))].sort((a, b) => a.localeCompare(b));
  const programTypes = [...new Set(optionRows.map((row) => row.programType))].sort((a, b) => a.localeCompare(b));

  return {
    report: {
      id: REPORT.id,
      title: REPORT.title,
      customer: user.customer,
      asOf: new Date().toISOString(),
      from,
      to,
    },
    dataset: datasetRecord ? { id: datasetRecord.id, name: datasetRecord.name } : null,
    kpis: request.measures.map((key) => ({
      key,
      label: MEASURES[key].label,
      format: MEASURES[key].format,
      value: round2(total?.[key]),
    })),
    filterOptions: { market: markets, programType: programTypes },
    appliedFilters,
    rows: monthRows.map((row) => {
      const shaped: SavingsInvoiceResponse['rows'][number] = { month: String(row.month).trim() };
      for (const key of request.measures) shaped[key] = round2(row[key]);
      return shaped;
    }),
  };
}
