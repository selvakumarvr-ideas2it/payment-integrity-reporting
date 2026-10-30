const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonth(key: string): string {
  const [year, month] = key.split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${name}-${year}` : key;
}

export function formatValue(value: number | null | undefined, format: string): string {
  if (value === null || value === undefined) return '';
  if (format === 'currency') return currency.format(value);
  if (format === 'month') return formatMonth(String(value));
  return integer.format(value);
}
