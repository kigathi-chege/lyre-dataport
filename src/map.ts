import type { RawRow, MappedRow, FieldSpec, ImportSpec } from './types.js';

/** Thrown to reject a single row; the runner turns it into a {@link RowError}. */
export class RowRejection extends Error {}

function pick(row: RawRow, from: FieldSpec['from'], fallback: string): string {
  const keys = from === undefined ? [fallback] : Array.isArray(from) ? from : [from];
  for (const k of keys) {
    const v = row[k as string];
    if (v !== undefined && v !== '') return v;
  }
  // Return the first key's raw value (possibly '') so required-checks see empties.
  const first = (Array.isArray(from) ? from[0] : from) ?? fallback;
  return row[first as string] ?? '';
}

function coerce(value: string, type: FieldSpec['type']): unknown {
  if (value === '') return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new RowRejection(`not a number: "${value}"`);
      return n;
    }
    case 'boolean': {
      const v = value.toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(v)) return true;
      if (['false', '0', 'no', 'n'].includes(v)) return false;
      throw new RowRejection(`not a boolean: "${value}"`);
    }
    case 'date': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new RowRejection(`not a date: "${value}"`);
      return d;
    }
    default:
      return value;
  }
}

/**
 * Map one raw row to a validated output row per the spec. Throws {@link RowRejection} on the first
 * failing field so the runner can record the reason and skip the row.
 */
export function mapRow(raw: RawRow, spec: ImportSpec): MappedRow {
  const out: MappedRow = {};
  for (const f of spec.fields) {
    let cell = pick(raw, f.from, f.to);
    if (f.trim !== false) cell = cell.trim();

    if (f.required && cell === '') {
      throw new RowRejection(`missing required field "${f.to}"`);
    }

    let value: unknown = coerce(cell, f.type);
    if (f.transform) value = f.transform(value, raw);
    out[f.to] = value;
  }
  return out;
}

/** True when every mapped value is null/undefined/empty-string. */
export function isEmptyRow(row: MappedRow): boolean {
  for (const v of Object.values(row)) {
    if (v !== null && v !== undefined && v !== '') return false;
  }
  return true;
}
