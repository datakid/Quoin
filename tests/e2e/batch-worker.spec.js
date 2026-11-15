import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { inspectWorkbook } from '../../src/batch/index/inspect.js';
import { openApp, fx, ext } from './helpers.js';

const bytesOf = (path) => new Uint8Array(readFileSync(path));
const meta = (name, bytes) => ({ id: 'f0001', name, relPath: name, size: bytes.length });

const talk = (page, { url, name, messages }) =>
  page.evaluate(
    async ({ url, name, messages }) => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const worker = new Worker('/src/workers/m-worker.js', { type: 'module' });
      const received = [];
      worker.onmessage = (ev) => received.push(ev.data);
      const errors = [];
      worker.onerror = (e) => errors.push(e.message);
      const fileRef = { id: 'f0001', name, relPath: name, size: bytes.length, lastModified: 1731542400000, file: new File([bytes], name) };
      for (const m of messages) worker.postMessage({ ...m, fileRef: m.fileRef === undefined ? fileRef : m.fileRef });
      const start = performance.now();
      while (received.length < messages.filter((m) => m.expectReply !== false).length && performance.now() - start < 15000) await new Promise((r) => setTimeout(r, 25));
      worker.terminate();
      return { received, errors };
    },
    { url, name, messages }
  );

test('batch worker: open reads a File in the worker and returns the same FileIndex as Node', async ({ page }) => {
  await openApp(page);
  const path = fx('mixed.xlsm');
  const { received, errors } = await talk(page, { url: '/tests/fixtures/workbooks/mixed.xlsm', name: 'mixed.xlsm', messages: [{ type: 'open' }] });
  expect(errors).toEqual([]);
  expect(received).toHaveLength(1);
  expect(received[0].type).toBe('opened');
  expect(received[0].fileId).toBe('f0001');
  expect(received[0].index).toEqual(await indexWorkbook(bytesOf(path), meta('mixed.xlsm', bytesOf(path))));
  expect(received[0].index.queries.map((q) => q.name)).toEqual(['fGetNamedRange', 'RawInput', 'FinalTable']);
});

test('batch worker: a refused file gets a refused message with its code', async ({ page }) => {
  await openApp(page);
  const cases = [
    ['/tests/fixtures/workbooks/encrypted.xlsx', 'encrypted.xlsx', 'file.encrypted'],
    ['/tests/fixtures/workbooks/mixed.xlsm', '~$mixed.xlsm', 'file.lockFile'],
    ['/tests/fixtures/workbooks/mixed.xlsm', 'mixed.csv', 'file.unsupportedExtension'],
    ['/tests/fixtures/external/binary.xlsb', 'renamed.xlsx', 'file.xlsb']
  ];
  for (const [url, name, code] of cases) {
    const { received } = await talk(page, { url, name, messages: [{ type: 'open' }] });
    expect(received).toEqual([{ type: 'refused', fileId: 'f0001', code }]);
  }
});

test('batch worker: inspect fills nonEmpty and matches Node', async ({ page }) => {
  await openApp(page);
  const path = ext('pq_vba_complex.xlsm');
  const { received } = await talk(page, { url: '/tests/fixtures/external/pq_vba_complex.xlsm', name: 'pq_vba_complex.xlsm', messages: [{ type: 'inspect', need: ['nonEmpty'] }] });
  expect(received).toHaveLength(1);
  expect(received[0].type).toBe('inspected');
  expect(received[0].index.sheets.every((s) => s.nonEmpty === true)).toBe(true);
  expect(received[0].index).toEqual(await inspectWorkbook(bytesOf(path), meta('pq_vba_complex.xlsm', bytesOf(path)), ['nonEmpty']));
});

test('batch worker: malformed messages are ignored or refused and the next files still open', async ({ page }) => {
  await openApp(page);
  const { received, errors } = await talk(page, {
    url: '/tests/fixtures/workbooks/mixed.xlsm',
    name: 'mixed.xlsm',
    messages: [{ type: 'open', fileRef: null, expectReply: false }, { type: 'open', fileRef: { id: 'f0009', name: 'a.xlsx' } }, { type: 'inspect', need: [], expectReply: false }, { type: 'inspect', need: ['nonEmpty'] }, { type: 'open' }]
  });
  expect(errors).toEqual([]);
  expect(received.map((r) => `${r.type}:${r.fileId}`).sort()).toEqual(['inspected:f0001', 'opened:f0001', 'refused:f0009']);
  expect(received.find((r) => r.type === 'refused').code).toBe('file.notWorkbook');
});

test('batch worker: the existing run message still works in the same worker file', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(async () => {
    const { Runner } = await import('/src/app/runner.js');
    const r = new Runner();
    const res = await r.run({ sectionText: 'section Section1;\r\n\r\nshared Q = #table({"a"}, {{7}});', queryName: 'Q', culture: 'en-US', limits: {}, previewRows: 5 }, { onNeedBinding: async () => null });
    const rows = await r.rowsOf(res.resultId, 0, 5, r.generation);
    return { status: res.status, rows: rows.rows };
  });
  expect(out).toEqual({ status: 'ok', rows: [[7]] });
});
