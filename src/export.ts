import type { ExportSpec, ExportSource, ColumnSpec } from './types.js';
import { csvHeaderLine, csvRowLine } from './csv.js';

/**
 * Stream an export as CSV: yields the header (once), then one line per source row, each terminated
 * with CRLF. The source is consumed lazily, so a keyset-chunked DB cursor never materialises the
 * full set in memory. A `ReportResult.data` array is equally a valid source.
 *
 * The host pipes these chunks straight to its HTTP response.
 */
export async function* createExportStream<Row extends Record<string, unknown>>(
  spec: ExportSpec<Row>,
  source: ExportSource<Row>,
): AsyncIterable<string> {
  const columns = spec.columns as readonly ColumnSpec<Row>[];
  if (spec.header !== false) {
    yield csvHeaderLine(columns) + '\r\n';
  }
  for await (const row of toAsync(source.rows())) {
    yield csvRowLine(row, columns) + '\r\n';
  }
}

/** Materialise an export to a single CSV string (small sets, templates, tests). */
export async function toCsvString<Row extends Record<string, unknown>>(
  spec: ExportSpec<Row>,
  source: ExportSource<Row>,
): Promise<string> {
  let out = '';
  for await (const chunk of createExportStream(spec, source)) out += chunk;
  return out;
}

async function* toAsync<T>(it: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(it)) {
    yield* it as AsyncIterable<T>;
  } else {
    for (const x of it as Iterable<T>) yield x;
  }
}
