import { formatMonth } from './data/schema.js';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatValue(value, format) {
  if (value === null || value === undefined) return '';
  switch (format) {
    case 'currency':
      return currency.format(value);
    case 'month':
      return formatMonth(value);
    case 'number':
    default:
      return integer.format(value);
  }
}
