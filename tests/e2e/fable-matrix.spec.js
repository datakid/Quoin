import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const text = (s) => Buffer.from(s).toString('base64');
const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
const headers = (page) => matrix(page).locator('.grid-hcell .hname');

const fakeRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    run_id: 'r1',
    file: `book${String(i).padStart(4, '0')}.xlsx`,
    folder: 'east/',
    unit: 'book',
    unit_index: 1,
    recipe: 'collect',
    action: 'collect',
    compute: '',
    verdict: ['unchanged', 'changed', 'skipped', 'failed', 'refused', 'cancelled', 'not-released'][i % 7],
    reason_code: i % 7 >= 2 ? 'file.encrypted' : '',
    reason: i % 7 >= 2 ? 'This workbook is encrypted. Remove the password in Excel first.' : '',
    old_hash: 'a'.repeat(64),
    new_hash: 'b'.repeat(64),
    output: '',
    verified: true,
    signature_removed: false,
    duration_ms: 1
  }));

async function exportRun(page) {
  await openApp(page);
  await dropTree(page, [{ name: 'books', children: [{ name: 'mixed.xlsm', data: b64(fx('mixed.xlsm')) }, { name: 'east', children: [{ name: 'pq_simple.xlsx', data: b64(ext('pq_simple.xlsx')) }, { name: 'notes.txt', data: text('x') }] }] }]);
  await waitForSet(page);
  await page.evaluate(() => window.__quoin.collectSet());
  await page.waitForFunction(() => window.__quoin.set.state === 'done');
}

test('fable matrix: after a run the Result region shows one table with the plan columns and one row per action', async ({ page }) => {
  await exportRun(page);
  await expect(matrix(page)).toBeVisible();
  await expect(headers(page)).toHaveText(['File', 'Unit', 'Action', 'Compute', 'Changed', 'Reason', 'Old hash', 'New hash']);
  const rows = await page.evaluate(() => window.__quoin.shell.matrix.grid.rowCount);
  expect(rows).toBe(6 + 1 + 1);
  await expect(matrix(page).locator('.grid-row').first()).toContainText('books/east/notes.txt');
});

test('fable matrix: skipped and refused rows read in words and use the neutral status, changed rows the good one', async ({ page }) => {
  await exportRun(page);
  const cell = (file, col) => matrix(page).locator('.grid-row', { hasText: file }).first().locator('.grid-cell:not(.grid-index)').nth(col);
  await expect(cell('notes.txt', 4)).toHaveText('Refused');
  await expect(cell('notes.txt', 4)).toHaveClass(/status-neutral/);
  await expect(cell('notes.txt', 5)).toContainText('Skipped. Quoin opens');
  await expect(cell('mixed.xlsm', 4)).toHaveText('No');
  await expect(cell('mixed.xlsm', 4)).toHaveClass(/status-neutral/);
});

test('fable matrix: verdict words and status classes for every verdict', async ({ page }) => {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
  }, fakeRows(7));
  const col = matrix(page).locator('.grid-row .grid-cell:not(.grid-index):nth-child(6)');
  await expect(col).toHaveText(['No', 'Yes', 'Skipped', 'Failed', 'Refused', 'Cancelled', 'Not released']);
  await expect(col.nth(1)).toHaveClass(/status-good/);
  await expect(col.nth(3)).toHaveClass(/status-bad/);
  await expect(col.nth(6)).toHaveClass(/status-bad/);
});

test('fable matrix: the preview wording says Would change', async ({ page }) => {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'preview');
  }, fakeRows(3));
  await expect(headers(page).nth(4)).toHaveText('Would change');
});

test('fable matrix: five thousand rows paint only the visible ones and the last row can be reached', async ({ page }) => {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
  }, fakeRows(5000));
  const painted = await matrix(page).locator('.grid-row').count();
  expect(painted).toBeLessThan(80);
  await matrix(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+End');
  await expect(matrix(page).locator('.grid-row', { hasText: 'book4999.xlsx' })).toHaveCount(1);
  await page.keyboard.press('Control+Home');
  await expect(matrix(page).locator('.grid-row', { hasText: 'book0000.xlsx' })).toHaveCount(1);
});

test('fable matrix: five thousand rows are trimmed to the visible ones before the call that shows them returns', async ({ page }) => {
  await openApp(page);
  const painted = await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
    return document.querySelectorAll('.grid .grid-row').length;
  }, fakeRows(5000));
  expect(painted).toBeLessThan(80);
});

test('fable matrix: the keyboard moves between cells and Tab leaves the table', async ({ page }) => {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
  }, fakeRows(20));
  await matrix(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(matrix(page).locator('.grid-cell.active')).toHaveCount(1);
  await expect(matrix(page).locator('.grid-cell.active')).toHaveAttribute('id', 'gc-1-1');
  await page.keyboard.press('Tab');
  await expect(matrix(page)).not.toBeFocused();
});

test('fable matrix: starting a new run clears the old table', async ({ page }) => {
  await exportRun(page);
  await expect(matrix(page)).toBeVisible();
  await page.evaluate(() => {
    const set = window.__quoin.set;
    set.beginChoose();
    set.endChoose();
    set.beginRun(1);
  });
  await expect(matrix(page)).toHaveCount(0);
});

test('fable matrix: dragging across cells extends the selection and releasing the button ends it', async ({ page }) => {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
  }, fakeRows(20));
  const cell = (r, c) => matrix(page).locator(`#gc-${r}-${c}`);
  const from = await cell(0, 0).boundingBox();
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  const to = await cell(3, 1).boundingBox();
  await page.mouse.move(to.x + 5, to.y + 5, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__quoin.shell.matrix.grid.sel)).toEqual({ r1: 0, r2: 3, c1: 0, c2: 1 });
  expect(await page.evaluate(() => window.__quoin.shell.matrix.grid.drag)).toBe(false);
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 5 });
  expect(await page.evaluate(() => window.__quoin.shell.matrix.grid.sel)).toEqual({ r1: 0, r2: 3, c1: 0, c2: 1 });
});
