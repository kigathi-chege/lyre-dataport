import type {
  ImportSpec,
  ImportSink,
  ImportResult,
  RowReader,
  RowError,
  MappedRow,
} from './types.js';
import { mapRow, isEmptyRow, RowRejection } from './map.js';

const DEFAULT_BATCH = 500;
const DEFAULT_MAX_ROWS = 5000;

export class ImportCapError extends Error {
  readonly code = 'row_cap_exceeded';
  constructor(readonly maxRows: number) {
    super(`Import exceeds the ${maxRows}-row cap.`);
    this.name = 'ImportCapError';
  }
}

/**
 * Run an import: read raw rows, map/validate each, batch the survivors, and hand each batch to the
 * host sink. Row-level failures (bad type, missing required, sink-reported error) are collected —
 * they never abort the run. Only the row cap aborts, and it does so BEFORE any sink write.
 *
 * The engine performs NO persistence: the sink owns resolve/upsert and relationship attach.
 */
export async function runImport<Row extends MappedRow = MappedRow>(
  spec: ImportSpec,
  reader: RowReader,
  sink: ImportSink<Row>,
): Promise<ImportResult> {
  const batchSize = spec.batchSize ?? DEFAULT_BATCH;
  const maxRows = spec.maxRows ?? DEFAULT_MAX_ROWS;
  const skipEmpty = spec.skipEmptyRows !== false;

  const errors: RowError[] = [];
  let total = 0; // input rows considered (post empty-skip)
  let created = 0;
  let matched = 0;
  let failed = 0;

  // Fail-fast on a known-length reader (the BFF pre-parsed array path), so an over-cap import
  // writes NOTHING. A purely streaming reader can't be pre-counted; there the cap still fires, but
  // only once the input crosses it (batches already flushed up to that point are the host's — the
  // host sizes batchSize ≥ maxRows when it needs the all-or-nothing guarantee, as inbox does).
  const known = (reader as { length?: number }).length;
  if (typeof known === 'number' && known > maxRows) throw new ImportCapError(maxRows);

  // Each pending entry keeps the ORIGINAL row index so sink errors map back to the input.
  let pending: { row: Row; index: number }[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const rows = pending.map((p) => p.row);
    const res = await sink.upsertBatch(rows);
    created += res.created;
    matched += res.matched;
    failed += res.failed ?? 0;
    for (const e of res.errors ?? []) {
      const origin = pending[e.index];
      if (origin) errors.push({ row: origin.index, reason: e.reason });
    }
    pending = [];
  };

  let inputIndex = -1;
  for await (const raw of toAsync(reader.rows())) {
    inputIndex++;
    // Cap on the INPUT count. Checked BEFORE this row's sink flush would occur, so a run that
    // trips the cap has written nothing yet: `pending` still holds the not-yet-flushed batch and
    // is discarded by the throw. (`inputIndex` is 0-based, so index === maxRows is row maxRows+1.)
    if (inputIndex >= maxRows) throw new ImportCapError(maxRows);

    // Skip a fully-blank line (trailing newline, spacer row) BEFORE validation — a blank line is
    // not a "row missing a required field", it is not a row at all. Cheap all-empty raw check.
    if (skipEmpty && isEmptyRaw(raw)) continue;

    let mapped: Row;
    try {
      mapped = mapRow(raw, spec) as Row;
    } catch (err) {
      failed++;
      errors.push({
        row: inputIndex,
        reason: err instanceof RowRejection ? err.message : String((err as Error).message ?? err),
      });
      total++;
      continue;
    }

    total++;
    pending.push({ row: mapped, index: inputIndex });
    if (pending.length >= batchSize) await flush();
  }
  await flush();

  return { total, created, matched, failed, errors };
}

function isEmptyRaw(raw: Record<string, string>): boolean {
  for (const v of Object.values(raw)) {
    if (v !== undefined && v.trim() !== '') return false;
  }
  return true;
}

async function* toAsync<T>(it: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(it)) {
    yield* it as AsyncIterable<T>;
  } else {
    for (const x of it as Iterable<T>) yield x;
  }
}
