/**
 * @~lyre/dataport — framework-agnostic streaming import/export.
 *
 * The engine owns data-flow; the host owns persistence through a {@link ImportSink} /
 * {@link ExportSource} adapter. No SQL, no ORM, no table names cross this boundary.
 *
 *   const result = await runImport(spec, csvReader(text), myContactsSink)
 *   for await (const chunk of createExportStream(spec, myContactsSource)) reply.write(chunk)
 */
export * from './types.js';
export { runImport, ImportCapError } from './import.js';
export { createExportStream, toCsvString } from './export.js';
export { csvReader, arrayReader } from './readers.js';
export { parseCsv, parseCsvRows, csvCell } from './csv.js';
export { mapRow, isEmptyRow, RowRejection } from './map.js';
