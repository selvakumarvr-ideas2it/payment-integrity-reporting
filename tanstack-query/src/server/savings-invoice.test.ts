import { describe, expect, it } from 'vitest';
import { HttpError } from './http';
import { parseSavingsInvoiceRequest, shiftMonth } from './savings-invoice';

function thrown(body: unknown): HttpError {
  try {
    parseSavingsInvoiceRequest(body);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected the request to be rejected');
}

describe('savings invoice request', () => {
  it('defaults measures and months, and does not read a customer id from the body', () => {
    const parsed = parseSavingsInvoiceRequest({ reportId: 'savings-invoice', customerId: 999 });
    expect(parsed.measures).toEqual(['claimsDenied', 'grossSavings', 'amount']);
    expect(parsed.months).toBe(24);
    expect(parsed).not.toHaveProperty('customerId');
    expect(parsed.filters).toEqual([]);
  });

  it('rejects unknown measures, attributes, grains, and months with a field path', () => {
    expect(thrown({ reportId: 'other' })).toMatchObject({ status: 400, field: 'reportId' });
    expect(thrown({ reportId: 'savings-invoice', measures: ['nope'] })).toMatchObject({ status: 400, field: 'measures[0]' });
    expect(thrown({ reportId: 'savings-invoice', filters: [{ attributeKey: 'customer_id', values: ['2'] }] })).toMatchObject({
      status: 400,
      field: 'filters[0].attributeKey',
    });
    expect(thrown({ reportId: 'savings-invoice', aggregates: [{ attributeKey: 'month', grain: 'day' }] })).toMatchObject({
      status: 400,
      field: 'aggregates[0].grain',
    });
    expect(thrown({ reportId: 'savings-invoice', months: 61 })).toMatchObject({ status: 400, field: 'months' });
    expect(thrown({ reportId: 'savings-invoice', months: 0 }).status).toBe(400);
  });

  it('keeps the latest N months, including the end month', () => {
    expect(shiftMonth('2026-09', -23)).toBe('2024-10');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });
});
