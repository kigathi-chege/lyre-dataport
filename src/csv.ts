/**
 * CSV serialisation/deserialisation — RFC 4180-ish, no dependency.
 *
 * Handles quoted fields, embedded commas/newlines, and escaped quotes (`""`). Deliberately small:
 * the engine targets flat tabular data (a contact row), not arbitrary CSV dialects.
 */
import type { RawRow, ColumnSpec } from './types.js';

/**
 * Detect the delimiter from the header line: `,` `;` or tab, whichever occurs most OUTSIDE quotes.
 *
 * Not a dialect engine — one heuristic for one real problem. Excel writes `;` in any locale whose
 * decimal separator is a comma, and spreadsheet exports write tabs. Parsed as comma, such a file
 * yields ONE column per row, every header lookup misses, and the import silently does nothing.
 */
export function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t'];
  let line = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      line += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    line += ch;
  }
  // Count only unquoted occurrences: a header like `"Last, First"` must not vote for comma.
  const score = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  let best = ',';
  let bestScore = 0;
  for (const d of candidates) {
    const s = score(d);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

/** Strip a UTF-8 BOM, which Excel prepends and which would otherwise corrupt the first header. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Find the header row, skipping blank lines and a title/preamble line above it.
 *
 * Spreadsheet "report" exports often put a title in row 1 (`Contacts Export 2026`), which would
 * otherwise BECOME the header — the real header is then read as data and every column lookup
 * misses. A preamble line is recognised by shape, not content: it has one cell where a following
 * line has several.
 *
 * Returns the index of the row to treat as the header, or -1 when there is nothing usable.
 */
export function findHeaderRow(rows: readonly string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]!;
    const nonEmpty = cells.filter((c) => c.trim() !== '').length;
    if (nonEmpty === 0) continue; // blank line
    // A single-cell line followed by a wider one is a title, not a header.
    if (nonEmpty === 1) {
      const next = rows[i + 1];
      if (next && next.filter((c) => c.trim() !== '').length > 1) continue;
    }
    return i;
  }
  return -1;
}

/** Parse a full CSV string into records keyed by the header row. */
export function parseCsv(text: string, delimiter?: string): RawRow[] {
  const allRows = parseCsvRows(text, delimiter);
  const headerAt = findHeaderRow(allRows);
  if (headerAt < 0) return [];
  const rows = allRows.slice(headerAt);
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

/**
 * Low-level: CSV string → array of string-cell arrays (header included).
 *
 * `delimiter` defaults to whatever {@link detectDelimiter} finds on the header line. A UTF-8 BOM is
 * stripped first, so the first header is `Name` and not `﻿Name`.
 */
export function parseCsvRows(text: string, delimiter?: string): string[][] {
  text = stripBom(text);
  const delim = delimiter ?? detectDelimiter(text);
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
    if (ch === delim) {
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
