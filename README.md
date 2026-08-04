# @~lyre/dataport

Framework-agnostic streaming **import/export** for Node. The engine owns data-flow
(parse → map → validate → batch → sink; source → format → stream). The **host** owns persistence
through a thin `Sink` (import) or `Source` (export) adapter — the engine never builds SQL, never
knows a table name. That boundary is the whole design: it keeps the package reusable across any Node
project and keeps relationship resolution inside the host's own ORM.

## Import

```ts
import { runImport, csvReader, type ImportSpec, type ImportSink } from '@~lyre/dataport'

const spec: ImportSpec = {
  fields: [
    { to: 'firstName', from: 'first_name', required: true },
    { to: 'email' },
    { to: 'age', type: 'number' },
  ],
  batchSize: 500,
  maxRows: 5000, // over-cap fails BEFORE any write (for known-length readers)
}

const sink: ImportSink = {
  async upsertBatch(rows) {
    // YOUR persistence: resolveOrCreate, attach relationships, etc.
    // return { created, matched, failed?, errors?: [{ index, reason }] }
  },
}

const result = await runImport(spec, csvReader(csvText), sink)
// { total, created, matched, failed, errors: [{ row, reason }] }
```

Row-level failures (bad type, missing required, sink-reported) are collected and never abort the
run; only the row cap aborts.

## Export

```ts
import { createExportStream, type ExportSpec, type ExportSource } from '@~lyre/dataport'

const spec: ExportSpec = {
  columns: [
    { key: 'name', header: 'Name' },
    { key: 'spend', header: 'Spend', format: (v) => Number(v ?? 0).toFixed(2) },
  ],
}

const source: ExportSource = {
  rows() {
    return myKeysetChunkedCursor() // async iterable — never materialises the full set
  },
}

for await (const chunk of createExportStream(spec, source)) reply.write(chunk)
```

A `ReportResult.data` array is a valid `ExportSource`, so exporting a report is the same exporter
with the report rows as its source.

## Scope

CSV in/out (streaming, RFC-4180-ish quoting). xlsx is intentionally out of scope for now — it can't
stream row-by-row without a zip lib + buffering; add it as an optional formatter when needed. No
runtime dependencies; `zod` is an optional peer if you want schema-based field validation in a
`transform`.
