import type { FilterClause } from '@/model';

export type FilterState = { market: string[]; programType: string[] };

export const EMPTY_FILTERS: FilterState = { market: [], programType: [] };

export function toFilterList(filters: FilterState): FilterClause[] {
  const list: FilterClause[] = [];
  if (filters.market.length) list.push({ attributeKey: 'market', values: [...filters.market].sort() });
  if (filters.programType.length) list.push({ attributeKey: 'programType', values: [...filters.programType].sort() });
  return list;
}

export function fromFilterList(list: FilterClause[] = []): FilterState {
  const out: FilterState = { market: [], programType: [] };
  for (const filter of list) {
    if (filter.attributeKey === 'market' || filter.attributeKey === 'programType') {
      out[filter.attributeKey] = [...filter.values].sort();
    }
  }
  return out;
}

export function sameFilters(left: FilterState, right: FilterState): boolean {
  return JSON.stringify(toFilterList(left)) === JSON.stringify(toFilterList(right));
}

export function describeFilters(filters: FilterState): string {
  const parts: string[] = [];
  if (filters.market.length) parts.push(`Market: ${filters.market.join(', ')}`);
  if (filters.programType.length) parts.push(`Program Type: ${filters.programType.join(', ')}`);
  return parts.length ? parts.join(' · ') : 'All data (no filters)';
}
