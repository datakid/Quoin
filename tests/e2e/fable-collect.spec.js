import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkbook } from '../../src/core/workbook.js';
import { queryFile } from '../../src/core/export/files.js';
import { Package } from '../../src/core/opc.js';
import { readZip } from '../../src/core/zip-read.js';
import { ext, fx, openApp, dropTree, setSnapshot, waitForSet, saveDownload } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const text = (s) => Buffer.from(s).toString('base64');
const exportButton = (page) => page.getByRole('button', { name: 'Export everything' });

async function entriesOf(path) {
  const pkg = new Package(readZip(new Uint8Array(readFileSync(path))));
  const out = new Map();
  for (const n of pkg.names()) out.set(n, await pkg.bytes(n));
  return out;
}

const tree = () => [
  {
    name: 'books',
    children: [
      { name: 'mixed.xlsm', data: b64(fx('mixed.xlsm')) },
      { name: 'east', children: [{ name: 'pq_simple.xlsx', data: b64(ext('pq_simple.xlsx')) }, { name: 'notes.txt', data: text('hello') }, { name: 'broken.xlsx', data: text('not a workbook') }] }
    ]
  }
];

test('fable collect: export everything downloads one zip with a folder per workbook, an index and a report', async ({ page }, testInfo) => {
  await openApp(page);
  await dropTree(page, tree());
  await waitForSet(page);
  await expect(exportButton(page)).toBeVisible();
  const path = join(testInfo.outputPath('collect'), 'out.zip');
  const name = await saveDownload(page, exportButton(page), path);
  expect(name).toMatch(/^Collect \d{4}-\d{2}-\d{2}\.zip$/);
  const entries = await entriesOf(path);
  const names = [...entries.keys()];
  expect(names.slice(0, 2)).toEqual(['index.xlsx', 'report.csv']);
  expect(names).toContain('books/mixed/queries/RawInput.m');
  expect(names).toContain('books/mixed/modules/Module1.bas');
  expect(names.some((n) => n.startsWith('books/east/pq_simple/queries/'))).toBe(true);
  expect(names.some((n) => n.startsWith('books/east/broken'))).toBe(false);
  const wb = await openWorkbook(new Uint8Array(readFileSync(fx('mixed.xlsm'))), 'mixed.xlsm');
  const raw = wb.queries.find((q) => q.name === 'RawInput');
  expect(Array.from(entries.get('books/mixed/queries/RawInput.m'))).toEqual(Array.from(queryFile(raw.name, raw.original).data));
  const csv = new TextDecoder().decode(entries.get('report.csv').slice(3)).split('\r\n').filter(Boolean);
  expect(csv[0].startsWith('run_id,file,folder,unit,')).toBe(true);
  const rows = csv.slice(1).join('\n');
  expect(rows).toContain('notes.txt');
  expect(rows).toContain('broken.xlsx');
  expect(rows).toContain('refused');
  const snap = await setSnapshot(page);
  expect(snap.state).toBe('done');
  expect(snap.move).toBe(null);
  expect([snap.counts.ready, snap.counts.skipped, snap.counts.failed]).toEqual([2, 2, 0]);
  await expect(page.locator('.set-run-text')).toHaveText('Done');
});

test('fable collect: Cancel during a run produces no download and the run can be started again', async ({ page }, testInfo) => {
  await openApp(page);
  const data = b64(ext('pq_simple.xlsx'));
  await dropTree(page, [{ name: 'many', children: Array.from({ length: 80 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.xlsx`, data })) }]);
  await waitForSet(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.evaluate(() => {
    const run = window.__quoin.collectSet();
    window.__quoinRun = run;
    window.__quoin.cancelSetRun();
  });
  await page.waitForTimeout(1500);
  expect(downloads).toBe(0);
  expect((await setSnapshot(page)).state).toBe('ready');
  await expect(exportButton(page)).toBeVisible();
  const path = join(testInfo.outputPath('again'), 'out.zip');
  await saveDownload(page, exportButton(page), path);
  const names = [...(await entriesOf(path)).keys()];
  expect(names.filter((n) => n.endsWith('.m')).length).toBeGreaterThanOrEqual(80);
  expect((await setSnapshot(page)).state).toBe('done');
});

test('fable collect: the run bar shows Cancel while running and the button is hidden while indexing', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
  });
  await expect(page.locator('.set-shell')).toHaveCount(1);
  await expect(exportButton(page)).toBeHidden();
  await page.evaluate(() => {
    const set = window.__quoin.set;
    set.indexed('f0001', { status: 'ready', queries: [{ name: 'Q' }] });
    set.beginRun(1);
  });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(exportButton(page)).toBeHidden();
});
