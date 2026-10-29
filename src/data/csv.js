import Papa from 'papaparse';

const PARSE_OPTIONS = { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() };

function check(result) {
  const fatal = result.errors.filter((e) => e.type !== 'FieldMismatch');
  if (fatal.length) throw new Error(`CSV parse error on row ${fatal[0].row ?? '?'}: ${fatal[0].message}`);
  return result.data;
}

/** Parse CSV text into an array of objects keyed by header. */
export function parseCsvText(text) {
  return check(Papa.parse(text, PARSE_OPTIONS));
}

/** Parse a File chosen by the user (browser File / Blob). */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      ...PARSE_OPTIONS,
      complete: (result) => {
        try {
          resolve(check(result));
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
    });
  });
}
