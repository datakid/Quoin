import { test, expect } from '@playwright/test';
import { ext, fx } from './helpers.js';
import { NEW_M, inject, give, openSet, previewed, previewButton, getButton, matrix, panel, zipOf, sha, indexOf, previewState } from './fable-batch.js';
import { indexWorkbook } from '../../src/batch/index/file-index.js';
import { sha256Text } from '../../src/batch/index/hash.js';

const books = [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')], ['pq_vba_complex.xlsm', ext('pq_vba_complex.xlsm')]];

const reopen = (entries, path) => indexWorkbook(entries.get(path), { id: 'x', name: path.split('/').pop(), relPath: path, size: entries.get(path).length });
const download = async (page) => {
  const [file] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  return zipOf(file);
};
const rowsFor = (plan, file) => plan.rows.filter((r) => r.file === file);
const reasonOf = (plan, file) => rowsFor(plan, file)[0].reason;
const shownReason = (page, at) => page.evaluate((i) => window.__quoin.shell.matrix.grid.rowAt(i)[5], at);

test('fable inject: adding a query writes it into every workbook, keeps what was there, and the outputs reopen', async ({ page }) => {
  await previewed(page, books, inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M }));
  const plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.action, r.verdict])).toEqual([['mixed.xlsm', 'add', 'changed'], ['pq_simple.xlsx', 'add', 'changed'], ['pq_vba_complex.xlsm', 'add', 'changed']]);
  const before = await indexOf(page);
  const entries = await download(page);
  expect([...entries.keys()].sort()).toEqual(['books/mixed.xlsm', 'books/pq_simple.xlsx', 'books/pq_vba_complex.xlsm', 'report.csv']);
  for (const ix of before) {
    const after = await reopen(entries, ix.relPath);
    expect(after.status, ix.relPath).toBe('ready');
    expect(after.queries.map((q) => q.name).sort(), ix.relPath).toEqual([...ix.queries.map((q) => q.name), 'Added'].sort());
    for (const q of ix.queries) expect(after.queries.find((x) => x.name === q.name).hash, `${ix.relPath} ${q.name}`).toBe(q.hash);
    expect(after.modules.map((m) => [m.name, m.hash]), ix.relPath).toEqual(ix.modules.map((m) => [m.name, m.hash]));
  }
});

test('fable inject: a replaced query shows the hash it had in the preview and the output carries exactly the hash the preview promised', async ({ page }) => {
  await openSet(page, books);
  const before = await indexOf(page);
  await give(page, inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M }));
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const plan = await previewState(page);
  const row = rowsFor(plan, 'pq_simple.xlsx')[0];
  const old = before.find((i) => i.relPath === 'books/pq_simple.xlsx').queries.find((q) => q.name === 'StudentResults').hash;
  expect([row.action, row.verdict, row.oldHash]).toEqual(['replace', 'changed', old]);
  expect(row.newHash).toMatch(/^[0-9a-f]{64}$/);
  expect(row.newHash).not.toBe(old);
  expect(rowsFor(plan, 'mixed.xlsm')[0].verdict).toBe('skipped');
  const entries = await download(page);
  const after = await reopen(entries, 'books/pq_simple.xlsx');
  expect(after.queries.find((q) => q.name === 'StudentResults').hash).toBe(row.newHash);
  expect(row.newHash).toBe(await sha256Text(NEW_M));
});

test('fable inject: adding a module goes only into workbooks that have a macro project, and says why for the one that does not', async ({ page }) => {
  await previewed(page, books, inject({ target: 'module', op: 'add', name: 'ModNew', text: 'Sub A()\r\nEnd Sub\r\n' }));
  const plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.verdict, r.code])).toEqual([['mixed.xlsm', 'changed', ''], ['pq_simple.xlsx', 'refused', 'refused.noMacros'], ['pq_vba_complex.xlsm', 'changed', '']]);
  expect(await shownReason(page, 1)).toBe('This file has no macro project. Nothing was changed.');
  const before = await indexOf(page);
  const entries = await download(page);
  expect([...entries.keys()].sort()).toEqual(['books/mixed.xlsm', 'books/pq_vba_complex.xlsm', 'report.csv']);
  for (const path of ['books/mixed.xlsm', 'books/pq_vba_complex.xlsm']) {
    const after = await reopen(entries, path);
    const was = before.find((i) => i.relPath === path);
    expect(after.modules.map((m) => m.name).sort(), path).toEqual([...was.modules.map((m) => m.name), 'ModNew'].sort());
    for (const m of was.modules) expect(after.modules.find((x) => x.name === m.name).hash, `${path} ${m.name}`).toBe(m.hash);
  }
});

test('fable inject: removing a module takes it out of the one workbook that has it and leaves the others untouched', async ({ page }) => {
  await previewed(page, books, inject({ target: 'module', op: 'remove', name: 'Module1' }));
  const plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.action, r.verdict])).toEqual([['mixed.xlsm', 'remove', 'changed'], ['pq_simple.xlsx', 'remove', 'skipped'], ['pq_vba_complex.xlsm', 'remove', 'skipped']]);
  const entries = await download(page);
  expect([...entries.keys()].sort()).toEqual(['books/mixed.xlsm', 'report.csv']);
  const after = await reopen(entries, 'books/mixed.xlsm');
  expect(after.modules.map((m) => m.name)).toEqual(['ThisWorkbook', 'Sheet1']);
});

test('fable inject: removing or renaming a query that loads to the workbook is refused in words, and with nothing to release Get is not offered', async ({ page }) => {
  await previewed(page, books, inject({ target: 'query', op: 'remove', name: 'StudentResults' }));
  let plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.verdict, r.code])).toEqual([['mixed.xlsm', 'skipped', 'skip.notApplicable'], ['pq_simple.xlsx', 'refused', 'refused.loaded'], ['pq_vba_complex.xlsm', 'skipped', 'skip.notApplicable']]);
  expect(reasonOf(plan, 'pq_simple.xlsx')).toBe('This query loads to the workbook, so it cannot be removed. Nothing was changed. (StudentResults!StudentResults)');
  expect(await shownReason(page, 1)).toBe(reasonOf(plan, 'pq_simple.xlsx'));
  await expect(getButton(page)).toBeHidden();
  await give(page, inject({ target: 'query', op: 'rename', name: 'RawInput', newName: 'RawInput2' }));
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.verdict, r.code])).toEqual([['mixed.xlsm', 'refused', 'refused.renameLoaded'], ['pq_simple.xlsx', 'skipped', 'skip.notApplicable'], ['pq_vba_complex.xlsm', 'refused', 'refused.renameLoaded']]);
  expect(await shownReason(page, 0)).toContain('This query loads to the workbook, so it cannot be renamed. Nothing was changed.');
  await expect(getButton(page)).toBeHidden();
});

test('fable inject: renaming a module is refused in words', async ({ page }) => {
  await previewed(page, books, inject({ target: 'module', op: 'rename', name: 'Module1', newName: 'Module9' }));
  const plan = await previewState(page);
  expect(plan.rows.every((r) => r.verdict === 'refused' && r.code === 'refused.unsupported')).toBe(true);
  expect(await shownReason(page, 0)).toBe('Renaming a module is not supported. Nothing was changed.');
  await expect(getButton(page)).toBeHidden();
});

test('fable inject: a pattern changes every match in each file and skips a file with no match', async ({ page }) => {
  await previewed(page, books, inject({ target: 'query', op: 'replace', match: 'pattern', name: 'Raw*', text: NEW_M }));
  const plan = await previewState(page);
  expect(plan.rows.map((r) => [r.file, r.verdict])).toEqual([['mixed.xlsm', 'changed'], ['pq_simple.xlsx', 'skipped'], ['pq_vba_complex.xlsm', 'changed']]);
  const entries = await download(page);
  for (const path of ['books/mixed.xlsm', 'books/pq_vba_complex.xlsm']) {
    const after = await reopen(entries, path);
    expect(after.queries.find((q) => q.name === 'RawInput').hash, path).toBe(await sha256Text(NEW_M));
  }
});

test('fable inject: no source file is ever opened for writing, and getting a zip opens no picker', async ({ page }) => {
  await page.addInitScript(() => {
    window.__writes = [];
    window.__pickers = [];
    const proto = window.FileSystemFileHandle && window.FileSystemFileHandle.prototype;
    if (proto && proto.createWritable) {
      const original = proto.createWritable;
      proto.createWritable = function (...args) {
        window.__writes.push(this.name);
        return original.apply(this, args);
      };
    }
    for (const k of ['showSaveFilePicker', 'showDirectoryPicker', 'showOpenFilePicker']) {
      if (window[k]) {
        const original = window[k];
        window[k] = (...args) => {
          window.__pickers.push(k);
          return original(...args);
        };
      }
    }
  });
  await previewed(page, books, inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M }));
  await download(page);
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
  expect(await page.evaluate(() => window.__pickers)).toEqual([]);
  await expect(panel(page).locator('.recipe-notes')).toContainText(/Downloaded Inject \d{4}-\d{2}-\d{2}\.zip\./);
});

test('fable inject: the zip entries are byte-identical to what a second preview of the same files promises', async ({ page }) => {
  await previewed(page, books, inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M }));
  const first = await previewState(page);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const second = await previewState(page);
  expect(second.rows.map((r) => [r.file, r.verdict, r.oldHash, r.newHash])).toEqual(first.rows.map((r) => [r.file, r.verdict, r.oldHash, r.newHash]));
  const entries = await download(page);
  for (const [path, hash] of second.hashes) expect(sha(entries.get(path)), path).toBe(hash);
});
