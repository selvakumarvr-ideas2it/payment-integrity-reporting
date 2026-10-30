import Papa from 'papaparse';

const PARSE_OPTIONS = { header: true, skipEmptyLines: 'greedy' as const, transformHeader: (header: string) => header.trim() };

function check(result: Papa.ParseResult<Record<string, unknown>>): Record<string, unknown>[] {
  const fatal = result.errors.filter((error) => error.type !== 'FieldMismatch');
  if (fatal.length) throw new Error(`CSV parse error on row ${fatal[0].row ?? '?'}: ${fatal[0].message}`);
  return result.data;
}

/** Parse CSV text into an array of objects keyed by header. */
export function parseCsvText(text: string): Record<string, unknown>[] {
  return check(Papa.parse<Record<string, unknown>>(text, PARSE_OPTIONS));
}

/** Parse a File chosen by the user. */
export function parseCsvFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      ...PARSE_OPTIONS,
      complete: (result) => {
        try {
          resolve(check(result));
        } catch (error) {
          reject(error);
        }
      },
      error: reject,
    });
  });
}
