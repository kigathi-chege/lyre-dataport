/**
 * CSV serialisation/deserialisation — RFC 4180-ish, no dependency.
 *
 * Handles quoted fields, embedded commas/newlines, and escaped quotes (`""`). Deliberately small:
 * the engine targets flat tabular data (a contact row), not arbitrary CSV dialects.
 */
import type { RawRow, ColumnSpec } from './types.js';

/** Parse a full CSV string into records keyed by the header row. */
export function parseCsv(text: string): RawRow[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const out: RawRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!;
    // A single empty trailing line parses to [''] — skip it.
    if (cells.length === 1 && cells[0] === '') continue;
    const rec: RawRow = {};
    for (let c = 0; c < header.length; c++) rec[header[c]!] = cells[c] ?? '';
    out.push(rec);
  }
  return out;
}

/** Low-level: CSV string → array of string-cell arrays (header included). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // Swallow CRLF as one line break.
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush the last field/row unless the input ended exactly on a newline.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Quote a single CSV cell when it contains a comma, quote, or newline. */
export function csvCell(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serialise a header row from an export column spec. */
export function csvHeaderLine<Row>(columns: readonly ColumnSpec<Row>[]): string {
  return columns.map((c) => csvCell(c.header ?? c.key)).join(',');
}

/** Serialise one data row from an export column spec. */
export function csvRowLine<Row extends Record<string, unknown>>(
  row: Row,
  columns: readonly ColumnSpec<Row>[],
): string {
  return columns
    .map((c) => {
      const raw = row[c.key];
      const s = c.format ? c.format(raw, row) : raw == null ? '' : String(raw);
      return csvCell(s);
    })
    .join(',');
}
