/**
 * @~lyre/dataport — shared contract types.
 *
 * The engine moves DATA. It never touches a database, never builds SQL, never knows a table name.
 * The host supplies persistence through a {@link ImportSink} (import) or an {@link ExportSource}
 * (export). That boundary is the whole design: it keeps the engine framework-agnostic and reusable,
 * and keeps relationship resolution — the part that can go wrong — inside the host's own ORM.
 */

/** A raw row as it comes off a reader: string cells keyed by column header. */
export type RawRow = Record<string, string>;

/** A validated, coerced row handed to the sink. */
export type MappedRow = Record<string, unknown>;

// ── import ─────────────────────────────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

export interface FieldSpec {
  /** Output key on the mapped row. */
  readonly to: string;
  /** Source column header(s); the first present, non-empty one wins. Defaults to `to`. */
  readonly from?: string | readonly string[];
  readonly type?: FieldType;
  readonly required?: boolean;
  /** Trim strings (default true). */
  readonly trim?: boolean;
  /**
   * Custom coercion/validation. Return the value to keep, or throw to reject the ROW with the
   * thrown message. Runs after type coercion.
   */
  readonly transform?: (value: unknown, row: RawRow) => unknown;
}

export interface ImportSpec {
  readonly fields: readonly FieldSpec[];
  /** Rows per sink batch (default 500). */
  readonly batchSize?: number;
  /** Hard cap; exceeding it fails the whole run before any sink write (default 5000). */
  readonly maxRows?: number;
  /** Drop rows where every mapped field is null/empty (default true). */
  readonly skipEmptyRows?: boolean;
}

export interface RowError {
  /** Zero-based row index in the input (header excluded). */
  readonly row: number;
  readonly reason: string;
}

/** What a sink reports back per batch. Indices are batch-local; the engine re-bases them. */
export interface BatchResult {
  readonly created: number;
  readonly matched: number;
  readonly failed?: number;
  readonly errors?: readonly { readonly index: number; readonly reason: string }[];
}

/** The host seam for import: it owns resolve/upsert + relationship attach. */
export interface ImportSink<Row extends MappedRow = MappedRow> {
  upsertBatch(rows: readonly Row[]): Promise<BatchResult>;
}

export interface ImportResult {
  readonly total: number;
  readonly created: number;
  readonly matched: number;
  readonly failed: number;
  readonly errors: readonly RowError[];
}

/** Yields raw rows. CSV text/stream, a pre-parsed array — anything async-iterable of RawRow. */
export interface RowReader {
  rows(): AsyncIterable<RawRow> | Iterable<RawRow>;
}

// ── export ─────────────────────────────────────────────────────────────────────────────────────

export interface ColumnSpec<Row = Record<string, unknown>> {
  /** Row key to read. */
  readonly key: string;
  /** Header text (defaults to key). */
  readonly header?: string;
  /** Cell formatter; defaults to a null-safe string cast. */
  readonly format?: (value: unknown, row: Row) => string;
}

export interface ExportSpec<Row = Record<string, unknown>> {
  readonly columns: readonly ColumnSpec<Row>[];
  /** Emit a header row (default true). */
  readonly header?: boolean;
}

/**
 * The host seam for export: an async row iterator. A keyset-chunked DB cursor and a plain
 * `ReportResult.data` array both satisfy it — which is why report-export is the same exporter.
 */
export interface ExportSource<Row = Record<string, unknown>> {
  rows(): AsyncIterable<Row> | Iterable<Row>;
}
