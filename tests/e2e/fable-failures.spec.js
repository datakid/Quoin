import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet, setSnapshot } from './helpers.js';
import { zipBomb, zipTraversal, zipBadCrc } from '../fixtures/generators/hostile.js';
import { give, previewButton, getButton, folderButton, zipOf, csvOf, previewState, panel, matrix } from './fable-batch.js';

const file = (path) => readFileSync(path).toString('base64');
const bytes = (u8) => Buffer.from(u8).toString('base64');
const text = (s) => Buffer.from(s).toString('base64');

const tree = () => [{ name: 'books', children: [
  { name: 'a.xlsx', data: file(ext('pq_simple.xlsx')) },
  { name: 'b.xlsm', data: file(fx('mixed.xlsm')) },
  { name: 'locked.xlsx', data: file(fx('encrypted.xlsx')) },
  { name: 'disguised.xlsx', data: file(ext('binary.xlsb')) },
  { name: 'binary.xlsb', data: file(ext('binary.xlsb')) },
  { name: 'old.xls', data: text('legacy') },
  { name: 'junk.xlsx', data: text('not a zip at all') },
  { name: 'bomb.xlsx', data: bytes(zipBomb()) },
  { name: 'traversal.xlsx', data: bytes(zipTraversal()) },
  { name: 'crc.xlsx', data: bytes(zipBadCrc()) },
  { name: 'notes.txt', data: text('hello') },
  { name: '~$a.xlsx', data: text('x') },
  { name: 'z.xlsx', data: file(ext('pq_simple.xlsx')) }
] }];

const expected = [
  ['a.xlsx', 'ready', null],
  ['b.xlsm', 'ready', null],
  ['binary.xlsb', 'skipped', 'file.unsupportedExtension'],
  ['bomb.xlsx', 'skipped', 'file.tooLarge'],
  ['crc.xlsx', 'skipped', 'file.notWorkbook'],
  ['disguised.xlsx', 'skipped', 'file.xlsb'],
  ['junk.xlsx', 'skipped', 'file.notWorkbook'],
  ['locked.xlsx', 'skipped', 'file.encrypted'],
  ['notes.txt', 'skipped', 'file.unsupportedExtension'],
  ['old.xls', 'skipped', 'file.unsupportedExtension'],
  ['traversal.xlsx', 'skipped', 'file.notWorkbook'],
  ['z.xlsx', 'ready', null],
  ['~$a.xlsx', 'skipped', 'file.lockFile']
];

const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };

async function hostileSet(page) {
  const problems = await openApp(page);
  await dropTree(page, tree());
  await waitForSet(page);
  return problems;
}

test('fable failures: every file that cannot be opened is skipped with its own reason and the good ones are still indexed', async ({ page }) => {
  const problems = await hostileSet(page);
  const snap = await setSnapshot(page);
  expect(snap.files.map((f) => [f.name, f.badge, f.skipReason])).toEqual(expected);
  expect(snap.counts.files).toBe(13);
  expect(snap.counts.ready).toBe(3);
  expect(snap.counts.skipped).toBe(10);
  expect(problems).toEqual([]);
});

test('fable failures: Preview plans the good files and accounts for each of the others with a refused row in words', async ({ page }) => {
  await hostileSet(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const plan = await previewState(page);
  expect(plan.counts.failed).toBe(0);
  expect(plan.counts.refused).toBe(10);
  expect([...new Set(plan.rows.map((r) => r.file))].sort()).toEqual(expected.map(([name]) => name).sort());
  for (const [name, badge, code] of expected.filter(([, badge]) => badge === 'skipped')) {
    const rows = plan.rows.filter((r) => r.file === name);
    expect(rows.length, name).toBe(1);
    expect([rows[0].verdict, rows[0].code], name).toEqual(['refused', code]);
    expect(rows[0].reason.length, name).toBeGreaterThan(10);
    expect(rows[0].reason, name).not.toMatch(/^file\./);
  }
  expect(plan.rows.filter((r) => r.file === 'a.xlsx' || r.file === 'z.xlsx').every((r) => r.verdict === 'changed')).toBe(true);
});

test('fable failures: Get releases only the good files and report.csv has a row for every file in the set', async ({ page }) => {
  await hostileSet(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const plan = await previewState(page);
  const [download] = await Promise.all([page.waitForEvent('download'), getButton(page).click()]);
  const entries = await zipOf(download);
  expect([...entries.keys()].filter((k) => k !== 'report.csv').sort()).toEqual(['books/a.xlsx', 'books/b.xlsm', 'books/z.xlsx']);
  const rows = csvOf(entries.get('report.csv'));
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const body = rows.slice(1);
  expect([...new Set(body.map((r) => r[col('file')]))].sort()).toEqual(expected.map(([name]) => name).sort());
  expect(body.length).toBe(plan.rows.length);
  for (const [name, , code] of expected.filter(([, badge]) => badge === 'skipped')) {
    const row = body.find((r) => r[col('file')] === name);
    expect([row[col('verdict')], row[col('reason_code')], row[col('output')]], name).toEqual(['refused', code, '""']);
    expect(row[col('reason')].length, name).toBeGreaterThan(10);
  }
  await expect(panel(page).locator('.recipe-notes')).toContainText('Downloaded Replace');
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('done');
});

test('fable failures: the same set into a folder writes the good files, no refused file, and a report that names every file', async ({ page }) => {
  await page.addInitScript(() => {
    const files = {};
    const make = (path) => ({
      name: path.split('/').pop() || 'out',
      async getDirectoryHandle(name) { return make(`${path}/${name}`); },
      async getFileHandle(name, opts) {
        const full = `${path}/${name}`;
        if (!(full in files) && !opts) throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        return {
          async createWritable() {
            let staged = null;
            return { async write(d) { staged = new Uint8Array(d); }, async close() { files[full] = staged; }, async abort() {} };
          },
          async getFile() {
            const b = files[full];
            return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
          }
        };
      },
      async removeEntry(name) { delete files[`${path}/${name}`]; }
    });
    window.__files = files;
    window.showDirectoryPicker = async () => make('out');
  });
  await hostileSet(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await folderButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('Wrote 3 workbooks and report.csv to out.');
  expect(await page.evaluate(() => Object.keys(window.__files).sort())).toEqual(['out/books/a.xlsx', 'out/books/b.xlsm', 'out/books/z.xlsx', 'out/report.csv']);
  const report = await page.evaluate(() => [...window.__files['out/report.csv']]);
  const rows = csvOf(Uint8Array.from(report));
  expect([...new Set(rows.slice(1).map((r) => r[rows[0].indexOf('file')]))].sort()).toEqual(expected.map(([name]) => name).sort());
});
