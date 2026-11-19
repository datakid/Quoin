import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkbook } from '../../src/core/workbook.js';
import { readZip } from '../../src/core/zip-read.js';
import { ext, openApp, dropTree, waitForSet, item, editor, runButton, downloadButton, status, saveDownload } from './helpers.js';

const FILE = 'pq_vba_complex.xlsm';
const OTHER = 'pq_simple.xlsx';
const b64 = (path) => readFileSync(path).toString('base64');
const row = (page, name) => page.locator('.set-file', { hasText: name });
const rowButton = (page, name) => row(page, name).getByRole('button');

async function inSet(page) {
  await openApp(page);
  await dropTree(page, [{ name: 'books', children: [{ name: FILE, data: b64(ext(FILE)) }, { name: OTHER, data: b64(ext(OTHER)) }] }]);
  await waitForSet(page);
}

async function enterFromSet(page) {
  await inSet(page);
  await rowButton(page, FILE).click();
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('.topbar .file-name')).toHaveText(FILE);
}

const editRaw = async (page) => {
  await item(page, 'RawInput').click();
  const q = await editor(page).inputValue();
  await editor(page).fill(`${q}\n// note`);
  return q;
};

test('fable parity: a file opens from the Files list by pointer and the list stays beside it', async ({ page }) => {
  await enterFromSet(page);
  await expect(page.locator('.set-shell')).toHaveAttribute('data-mode', 'file');
  await expect(rowButton(page, FILE)).toHaveAttribute('aria-current', 'true');
  await expect(rowButton(page, OTHER)).not.toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[role=treeitem][data-type=query]')).toHaveCount(3);
  await expect(page.locator('[role=treeitem][data-type=module]')).toHaveCount(2);
  await expect(status(page)).toContainText('3 queries · 2 modules');
  await expect(page).toHaveTitle(`${FILE} · quoin`);
});

test('fable parity: the Files list is one tab stop, arrows move between files and Enter opens one', async ({ page }) => {
  await inSet(page);
  await page.getByRole('searchbox', { name: 'Filter files' }).focus();
  await page.keyboard.press('Tab');
  await expect(rowButton(page, OTHER)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rowButton(page, FILE)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rowButton(page, OTHER)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('[role=treeitem][aria-selected=true]')).toBeFocused();
});

test('fable parity: only usable files can be opened', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [{ name: 'books', children: [{ name: FILE, data: b64(ext(FILE)) }, { name: 'notes.txt', data: Buffer.from('x').toString('base64') }] }]);
  await waitForSet(page);
  await expect(row(page, 'notes.txt').getByRole('button')).toHaveCount(0);
  await expect(rowButton(page, FILE)).toHaveCount(1);
});

test('fable parity: file details open from the file name and return focus to it', async ({ page }) => {
  await enterFromSet(page);
  await page.locator('.topbar .file-name').click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toContainText('xlsm');
  await expect(dlg).toContainText('3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar .file-name')).toBeFocused();
});

test('fable parity: the query list shows the function badge and the module list shows its kinds', async ({ page }) => {
  await enterFromSet(page);
  await expect(item(page, 'fGetNamedRange')).toContainText('ƒ');
  await expect(item(page, 'RawInput')).not.toContainText('ƒ');
  await expect(page.locator('[role=treeitem][data-type=module]')).toHaveCount(2);
  await item(page, 'Sheet1').click();
  await expect(editor(page)).toHaveValue(/Option Explicit/);
});

test('fable parity: the editor has line numbers and find, reached by keyboard', async ({ page }) => {
  await enterFromSet(page);
  await item(page, 'RawInput').click();
  await expect(page.locator('.editor-wrap .gutter, .editor-wrap .line-numbers, .editor-wrap [class*=gutter]').first()).toBeVisible();
  await editor(page).focus();
  await page.keyboard.press('Control+f');
  await page.locator('.findbar input[type=text]').fill('Source');
  await expect(page.locator('.findbar')).toContainText('1/');
  await page.keyboard.press('Escape');
  await expect(page.locator('.findbar')).toBeHidden();
});

test('fable parity: the edited marker, revert one and revert all, with the same marker in the Files list', async ({ page }) => {
  await enterFromSet(page);
  const original = await editRaw(page);
  await expect(page.locator('[data-name=RawInput] .dot-edited')).toBeVisible();
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Edited');
  await expect(downloadButton(page)).toHaveAccessibleName('Download — 1 change');
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(editor(page)).toHaveValue(original);
  await expect(page.locator('[data-name=RawInput] .dot-edited')).toHaveCount(0);
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Ready');
  await editRaw(page);
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Edited');
  await downloadButton(page).click();
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Revert all' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Revert all' }).last().click();
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Ready');
});

test('fable parity: Review changes lists the edit as a diff', async ({ page }) => {
  await enterFromSet(page);
  await editRaw(page);
  await downloadButton(page).click();
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg.locator('.change-name')).toHaveText(['RawInput']);
  await dlg.locator('.change-item').first().locator('summary').click();
  await expect(dlg.locator('.diff-add .diff-text')).toHaveText('// note');
  await page.keyboard.press('Escape');
  await expect(downloadButton(page)).toBeFocused();
});

test('fable parity: run a query, see the grid, the steps, and the comparison with Excel', async ({ page }) => {
  await enterFromSet(page);
  await item(page, 'RawInput').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('HELLO WORLD!');
  await expect(status(page)).toContainText('Matches the last Excel refresh');
  await page.getByRole('group', { name: 'Steps' }).getByRole('button', { name: 'Converted to Table' }).click();
  await expect(page.locator('.grid-hcell .hname').first()).toHaveText('Column1');
  await page.locator('.grid-cell:not(.grid-index)').first().click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.grid-cell.is-active, .grid-cell[aria-selected=true]').first()).toBeVisible();
});

test('fable parity: every export format works from a set', async ({ page }, testInfo) => {
  await enterFromSet(page);
  await item(page, 'RawInput').click();
  await runButton(page).click();
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('HELLO WORLD!');
  const exportAs = async (label, file) => {
    await page.getByRole('button', { name: 'Export' }).click();
    const target = join(testInfo.outputPath('exports'), file);
    const name = await saveDownload(page, page.getByRole('menuitem', { name: label }), target);
    return { name, body: readFileSync(target) };
  };
  expect((await exportAs('CSV (UTF-8)', 'a.csv')).body.toString('utf8')).toBe('RawInput\r\nHELLO WORLD!\r\n');
  expect((await exportAs('TSV', 'c.tsv')).body.toString('utf8')).toBe('RawInput\r\nHELLO WORLD!\r\n');
  expect((await exportAs('JSON (records)', 'd.json')).body.toString('utf8')).toBe('[{"RawInput":"HELLO WORLD!"}]');
  expect((await exportAs('New .xlsx', 'e.xlsx')).name).toBe('RawInput.xlsx');
  expect((await exportAs('This query (.m)', 'f.m')).body.toString('utf8')).toContain('Source = fGetNamedRange("InputText")');
  const all = await exportAs('Everything (.zip)', 'h.zip');
  expect(readZip(new Uint8Array(all.body)).entries.map((e) => e.name)).toEqual(expect.arrayContaining(['modules/Sheet1.cls', 'queries/RawInput.m']));
});

test('fable parity: print preview opens for the open file and closes again', async ({ page }) => {
  await enterFromSet(page);
  await item(page, 'RawInput').click();
  await runButton(page).click();
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Print' }).click();
  await expect(page.locator('.print-root')).toBeVisible();
  await expect(page.locator('.print-page').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.print-root')).toHaveCount(0);
});

test('fable parity: the shortcuts sheet opens with the question mark and the palette with the shortcut', async ({ page }) => {
  await enterFromSet(page);
  await item(page, 'RawInput').click();
  await page.keyboard.press('?');
  await expect(page.locator('dialog[open]')).toContainText('F3');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('fable parity: the theme choice applies and survives going back to the set', async ({ page }) => {
  await enterFromSet(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#set-theme').selectOption('dark');
  await page.locator('dialog[open]').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'All files' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('fable parity: download writes the edit and it reads back from the file', async ({ page }, testInfo) => {
  await enterFromSet(page);
  await editRaw(page);
  await downloadButton(page).click();
  const target = join(testInfo.outputPath('dl'), 'edited.xlsm');
  const name = await saveDownload(page, page.locator('.popover .btn-primary'), target);
  expect(name).toBe('pq_vba_complex (edited).xlsm');
  const wb = await openWorkbook(new Uint8Array(readFileSync(target)), 'edited.xlsm');
  expect(wb.queries.find((q) => q.name === 'RawInput').original).toContain('// note');
});

test('fable parity: All files goes back to the set at once when nothing is edited', async ({ page }) => {
  await enterFromSet(page);
  await page.getByRole('button', { name: 'All files' }).click();
  await expect(page.locator('.workspace')).toHaveCount(0);
  await expect(page.locator('.set-shell')).toHaveAttribute('data-mode', 'set');
  await expect(page.getByRole('button', { name: 'All files' })).toBeHidden();
  await expect(page.locator('.topbar .file-meta')).toHaveText('2 files · 4 queries');
  await expect(rowButton(page, FILE)).not.toHaveAttribute('aria-current', 'true');
});

test('fable parity: All files with unsaved edits asks first, and cancelling keeps the edits', async ({ page }) => {
  await enterFromSet(page);
  await editRaw(page);
  await page.getByRole('button', { name: 'All files' }).click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toContainText('1 unsaved change');
  await dlg.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('[data-name=RawInput] .dot-edited')).toBeVisible();
  await page.getByRole('button', { name: 'All files' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Discard and go back' }).click();
  await expect(page.locator('.workspace')).toHaveCount(0);
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Ready');
});

test('fable parity: choosing another file while one has unsaved edits uses the existing warning', async ({ page }) => {
  await enterFromSet(page);
  await editRaw(page);
  await rowButton(page, OTHER).click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg).toContainText('Opening another file discards 1 unsaved change.');
  await dlg.getByRole('button', { name: 'Discard and open' }).click();
  await expect(page.locator('.topbar .file-name')).toHaveText(OTHER);
  await expect(rowButton(page, OTHER)).toHaveAttribute('aria-current', 'true');
  await expect(row(page, FILE).locator('.set-badge')).toHaveText('Ready');
});

test('fable parity: a lone dropped workbook and a set both leave the single-file experience unchanged', async ({ page }) => {
  await openApp(page);
  await page.setInputFiles('input[type=file]', ext(FILE));
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('.set-shell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'All files' })).toBeHidden();
  await expect(status(page)).toContainText('3 queries · 2 modules');
});
