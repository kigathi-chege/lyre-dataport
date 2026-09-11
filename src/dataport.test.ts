import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  csvCell,
  runImport,
  ImportCapError,
  createExportStream,
  toCsvString,
  csvReader,
  arrayReader,
  type ImportSpec,
  type ImportSink,
  type ExportSpec,
  type ExportSource,
} from './index.js';

// ── CSV parse ────────────────────────────────────────────────────────────────────────────────
describe('parseCsv', () => {
  it('parses headers + rows keyed by header', () => {
    const rows = parseCsv('name,email\nAsha,asha@x.com\nBen,ben@y.com');
    expect(rows).toEqual([
      { name: 'Asha', email: 'asha@x.com' },
      { name: 'Ben', email: 'ben@y.com' },
    ]);
  });

  it('handles quoted commas, escaped quotes, and embedded newlines', () => {
    const rows = parseCsv('name,note\n"Doe, Jane","She said ""hi""\nline2"');
    expect(rows[0]).toEqual({ name: 'Doe, Jane', note: 'She said "hi"\nline2' });
  });

  it('handles CRLF and a trailing newline', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('is empty for an empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('csvCell', () => {
  it('quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "x"')).toBe('"he said ""x"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
});

// ── import ───────────────────────────────────────────────────────────────────────────────────
const CONTACT_SPEC: ImportSpec = {
  fields: [
    { to: 'firstName', from: 'first_name', required: true },
    { to: 'lastName', from: 'last_name' },
    { to: 'email' },
    { to: 'age', type: 'number' },
  ],
  batchSize: 2,
};

/** A sink that "creates" a row unless its email was seen before (then "matched") — idempotency. */
function memorySink(): ImportSink & { rows: Record<string, unknown>[] } {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    async upsertBatch(batch) {
      let created = 0;
      let matched = 0;
      for (const r of batch) {
        const key = String(r.email ?? `${r.firstName}:${r.lastName}`);
        if (seen.has(key)) matched++;
        else {
          seen.add(key);
          created++;
          rows.push(r);
        }
      }
      return { created, matched };
    },
  };
}

describe('runImport', () => {
  it('maps, batches, and reports created/matched', async () => {
    const reader = csvReader(
      'first_name,last_name,email,age\nAsha,K,asha@x.com,30\nBen,L,ben@y.com,25\nCy,M,cy@z.com,',
    );
    const sink = memorySink();
    const res = await runImport(CONTACT_SPEC, reader, sink);
    expect(res).toMatchObject({ total: 3, created: 3, matched: 0, failed: 0 });
    expect(sink.rows[0]).toEqual({ firstName: 'Asha', lastName: 'K', email: 'asha@x.com', age: 30 });
    expect(sink.rows[2]!.age).toBeNull(); // empty coerces to null
  });

  it('is idempotent on re-import (second run all matched)', async () => {
    const sink = memorySink();
    const csv = 'first_name,last_name,email\nAsha,K,asha@x.com';
    await runImport(CONTACT_SPEC, csvReader(csv), sink);
    const second = await runImport(CONTACT_SPEC, csvReader(csv), sink);
    expect(second).toMatchObject({ created: 0, matched: 1 });
  });

  it('rejects a row missing a required field, keeps the rest, maps the error to the input index', async () => {
    const reader = csvReader('first_name,email\nAsha,asha@x.com\n,noone@x.com');
    const res = await runImport(CONTACT_SPEC, reader, memorySink());
    expect(res.total).toBe(2);
    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual([{ row: 1, reason: 'missing required field "firstName"' }]);
  });

  it('rejects a bad number with the row index', async () => {
    const reader = arrayReader([{ first_name: 'A', age: 'NaNish' }]);
    const res = await runImport(CONTACT_SPEC, reader, memorySink());
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toEqual({ row: 0, reason: 'not a number: "NaNish"' });
  });

  it('propagates sink errors back to the input row index', async () => {
    const sink: ImportSink = {
      async upsertBatch(batch) {
        // Fail the row whose email is "bad@x.com".
        const errors = batch
          .map((r, i) => ({ i, r }))
          .filter((x) => x.r.email === 'bad@x.com')
          .map((x) => ({ index: x.i, reason: 'sink rejected' }));
        return { created: batch.length - errors.length, matched: 0, failed: errors.length, errors };
      },
    };
    const reader = csvReader(
      'first_name,email\nAsha,ok@x.com\nBen,bad@x.com\nCy,ok2@x.com',
    );
    const res = await runImport(CONTACT_SPEC, reader, sink);
    expect(res.errors).toEqual([{ row: 1, reason: 'sink rejected' }]);
  });

  it('enforces the row cap before any sink write', async () => {
    let called = false;
    const sink: ImportSink = {
      async upsertBatch() {
        called = true;
        return { created: 0, matched: 0 };
      },
    };
    const many = Array.from({ length: 10 }, (_, i) => ({ first_name: `n${i}` }));
    await expect(
      runImport({ ...CONTACT_SPEC, maxRows: 5 }, arrayReader(many), sink),
    ).rejects.toBeInstanceOf(ImportCapError);
    expect(called).toBe(false);
  });

  it('skips fully-empty rows without counting them', async () => {
    const reader = csvReader('first_name,email\nAsha,a@x.com\n,\nBen,b@x.com');
    const res = await runImport(CONTACT_SPEC, reader, memorySink());
    expect(res.total).toBe(2);
  });
});

// ── export ───────────────────────────────────────────────────────────────────────────────────
interface OutRow extends Record<string, unknown> {
  name: string;
  spend: number | null;
}
const EXPORT_SPEC: ExportSpec<OutRow> = {
  columns: [
    { key: 'name', header: 'Name' },
    { key: 'spend', header: 'Spend', format: (v) => (v == null ? '0.00' : Number(v).toFixed(2)) },
  ],
};

describe('createExportStream', () => {
  it('streams header + formatted rows with CRLF', async () => {
    const source: ExportSource<OutRow> = {
      rows() {
        return [
          { name: 'Asha', spend: 12.5 },
          { name: 'Doe, Jane', spend: null },
        ];
      },
    };
    const csv = await toCsvString(EXPORT_SPEC, source);
    expect(csv).toBe('Name,Spend\r\n' + 'Asha,12.50\r\n' + '"Doe, Jane",0.00\r\n');
  });

  it('consumes an async (chunked) source lazily', async () => {
    async function* gen(): AsyncIterable<OutRow> {
      for (let i = 0; i < 3; i++) yield { name: `n${i}`, spend: i };
    }
    const source: ExportSource<OutRow> = { rows: () => gen() };
    let lines = 0;
    for await (const chunk of createExportStream(EXPORT_SPEC, source)) {
      lines += chunk.split('\r\n').filter(Boolean).length;
    }
    expect(lines).toBe(4); // header + 3
  });

  it('a ReportResult.data array is a valid export source (the report-export seam)', async () => {
    const reportResult = { data: [{ name: 'Cynthia', spend: 175 }] as OutRow[] };
    const source: ExportSource<OutRow> = { rows: () => reportResult.data };
    const csv = await toCsvString(EXPORT_SPEC, source);
    expect(csv).toContain('Cynthia,175.00');
  });
});

/**
 * Dialect tolerance. Each case here is a file a spreadsheet really produces and the old
 * comma-only, row-0-is-the-header parser silently turned into zero usable columns.
 */
describe('parseCsv — real-world dialects', () => {
  const HEADER = 'Name,Phone,Email';
  const EXPECT = { Name: 'Jane Doe', Phone: '+254700000000', Email: 'jane@x.com' };

  it('parses a plain comma file (baseline)', () => {
    expect(parseCsv(`${HEADER}\r\nJane Doe,+254700000000,jane@x.com\r\n`)[0]).toEqual(EXPECT);
  });

  it('parses a semicolon file (Excel in comma-decimal locales)', () => {
    expect(parseCsv('Name;Phone;Email\r\nJane Doe;+254700000000;jane@x.com\r\n')[0]).toEqual(EXPECT);
  });

  it('parses a tab-delimited file', () => {
    expect(parseCsv('Name\tPhone\tEmail\r\nJane Doe\t+254700000000\tjane@x.com\r\n')[0]).toEqual(EXPECT);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    const rec = parseCsv(`﻿${HEADER}\r\nJane Doe,+254700000000,jane@x.com\r\n`)[0]!;
    expect(Object.keys(rec)[0]).toBe('Name');
    expect(rec).toEqual(EXPECT);
  });

  it('skips a title row above the header (report-style export)', () => {
    expect(parseCsv(`Contacts Export 2026\r\n${HEADER}\r\nJane Doe,+254700000000,jane@x.com\r\n`)[0])
      .toEqual(EXPECT);
  });

  it('skips leading blank lines', () => {
    expect(parseCsv(`\r\n\r\n${HEADER}\r\nJane Doe,+254700000000,jane@x.com\r\n`)[0]).toEqual(EXPECT);
  });

  it('does not mistake a quoted comma in a header for the delimiter', () => {
    const rec = parseCsv('"Last, First";Phone\r\n"Doe, Jane";+254700000000\r\n')[0]!;
    expect(rec['Last, First']).toBe('Doe, Jane');
    expect(rec['Phone']).toBe('+254700000000');
  });

  it('keeps a single-column file parseable (no following wider row to imply a title)', () => {
    expect(parseCsv('Email\r\njane@x.com\r\n')[0]).toEqual({ Email: 'jane@x.com' });
  });
});
