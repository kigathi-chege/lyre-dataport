import type { RawRow, RowReader } from './types.js';
import { parseCsv } from './csv.js';

/**
 * A reader over an in-memory array of already-parsed rows (the BFF-pre-parsed path). Exposes
 * `length` so `runImport` can enforce the row cap before writing anything.
 */
export function arrayReader(rows: readonly RawRow[]): RowReader & { length: number } {
  return {
    length: rows.length,
    rows() {
      return rows;
    },
  };
}

/** A reader that parses a CSV string. Materialised, so `length` is known for the cap check. */
export function csvReader(text: string): RowReader & { length: number } {
  const parsed = parseCsv(text);
  return {
    length: parsed.length,
    rows() {
      return parsed;
    },
  };
}
