import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ext, fx, openApp, dropFile, dropTree, setSnapshot, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const text = (s) => Buffer.from(s).toString('base64');

test('fable intake: a dropped folder becomes a set with paths, badges and query counts', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [
    {
      name: 'books',
      children: [
        { name: 'a.xlsx', data: b64(ext('pq_simple.xlsx')) },
        { name: 'east', children: [{ name: 'b.xlsm', data: b64(fx('mixed.xlsm')) }, { name: 'notes.txt', data: text('hello') }, { name: '~$b.xlsm', data: text('x') }] }
      ]
    }
  ]);
  await waitForSet(page);
  const snap = await setSnapshot(page);
  expect(snap.files.map((f) => f.relPath)).toEqual(['books/a.xlsx', 'books/east/b.xlsm', 'books/east/notes.txt', 'books/east/~$b.xlsm']);
  expect(snap.files.map((f) => f.badge)).toEqual(['ready', 'ready', 'skipped', 'skipped']);
  expect(snap.files.map((f) => f.skipReason)).toEqual([null, null, 'file.unsupportedExtension', 'file.lockFile']);
  expect(snap.files[1].queries).toEqual(['fGetNamedRange', 'RawInput', 'FinalTable']);
  expect(snap.counts.files).toBe(4);
  expect(snap.counts.queries).toBe(snap.files[0].queries.length + 3);
  expect(snap.move).toBe(null);
  await expect(page.locator('.workspace')).toHaveCount(0);
});

test('fable intake: workbooks that cannot be opened are skipped with their reason and the rest are indexed', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [
    { name: 'ok.xlsx', data: b64(ext('pq_simple.xlsx')) },
    { name: 'locked.xlsx', data: b64(fx('encrypted.xlsx')) },
    { name: 'junk.xlsx', data: text('not a zip at all') },
    { name: 'empty.xlsx', data: '' }
  ]);
  await waitForSet(page);
  const snap = await setSnapshot(page);
  expect(snap.files.map((f) => [f.relPath, f.badge, f.skipReason])).toEqual([
    ['empty.xlsx', 'skipped', 'file.notWorkbook'],
    ['junk.xlsx', 'skipped', 'file.notWorkbook'],
    ['locked.xlsx', 'skipped', 'file.encrypted'],
    ['ok.xlsx', 'ready', null]
  ]);
});

test('fable intake: dropping more files adds to the set and a repeat of the same file is ignored', async ({ page }) => {
  await openApp(page);
  const one = { name: 'a.xlsx', data: b64(ext('pq_simple.xlsx')) };
  const two = { name: 'b.xlsx', data: b64(ext('pq_simple.xlsx')) };
  const three = { name: 'c.xlsx', data: b64(ext('pq_simple.xlsx')) };
  await dropTree(page, [one, two]);
  await waitForSet(page);
  expect((await setSnapshot(page)).files.map((f) => f.relPath)).toEqual(['a.xlsx', 'b.xlsx']);
  await dropTree(page, [two, three]);
  await page.waitForFunction(() => window.__quoin.set.list().length === 3 && window.__quoin.set.state === 'ready');
  const snap = await setSnapshot(page);
  expect(snap.files.map((f) => f.relPath)).toEqual(['a.xlsx', 'b.xlsx', 'c.xlsx']);
});

test('fable intake: a lone dropped workbook still opens the workspace and makes no set', async ({ page }) => {
  await openApp(page);
  await dropFile(page, ext('pq_simple.xlsx'), 'pq_simple.xlsx');
  await expect(page.locator('.workspace')).toHaveCount(1);
  expect((await setSnapshot(page)).files).toEqual([]);
});

test('fable intake: the folder input creates a set with paths that include the folder', async ({ page }, testInfo) => {
  await openApp(page);
  const dir = join(testInfo.outputPath('picked'), 'quarter');
  mkdirSync(join(dir, 'east'), { recursive: true });
  copyFileSync(ext('pq_simple.xlsx'), join(dir, 'a.xlsx'));
  copyFileSync(fx('mixed.xlsm'), join(dir, 'east', 'b.xlsm'));
  await page.locator('input[webkitdirectory]').setInputFiles(dir);
  await waitForSet(page);
  const snap = await setSnapshot(page);
  expect(snap.files.map((f) => f.relPath)).toEqual(['quarter/a.xlsx', 'quarter/east/b.xlsm']);
  expect(snap.files.map((f) => f.badge)).toEqual(['ready', 'ready']);
});

test('fable intake: sixty workbooks are indexed by a bounded pool', async ({ page }) => {
  await openApp(page);
  const data = b64(ext('pq_simple.xlsx'));
  const children = Array.from({ length: 60 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.xlsx`, data }));
  await dropTree(page, [{ name: 'many', children }]);
  await waitForSet(page);
  const snap = await setSnapshot(page);
  expect(snap.files).toHaveLength(60);
  expect(snap.files.every((f) => f.badge === 'ready')).toBe(true);
  const stats = await page.evaluate(async () => (await import('/src/app/pool.js')).sharedPool().stats());
  expect(stats.workers).toBeLessThanOrEqual(stats.size);
  expect(stats.running + stats.queued).toBe(0);
});
