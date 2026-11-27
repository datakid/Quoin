import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, openApp, loadFile, item, editor, runButton } from './helpers.js';

const QUERY = [
  'let',
  '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}, {"Di", 41, "Paris"}, {"Ed", 25, "Rome"}, {"Flo", null, "Oslo"}}),',
  '    Typed = Table.TransformColumnTypes(Source, {{"Age", Int64.Type}})',
  'in',
  '    Typed'
].join('\n');

const head = (page) => page.locator('.result-head');
const grid = (page) => page.locator('.dock-panel[data-panel=result] [role=grid]').first();

async function setupSteps(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(QUERY);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(2);
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '7');
}

async function download(page, menuName) {
  await page.locator('.result-actions').getByRole('button', { name: 'Get a file' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: menuName }).click()]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
}

test('T-WB-16: the result header line gives rows, columns, time and the step, and follows the step cursor', async ({ page }) => {
  await setupSteps(page);
  await expect(head(page).locator('.result-line')).toHaveText(/^6 rows · 3 columns · \d+ ms · step 2 of 2$/);
  await editor(page).focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Typed');
  await expect(head(page).locator('.result-line')).toHaveText(/^6 rows · 3 columns · \d+ ms · step 2 of 2$/);
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.step-row.is-current')).toContainText('Source');
  await expect(head(page).locator('.result-line')).toHaveText(/^6 rows · 3 columns · \d+ ms · step 1 of 2$/);
});

test('T-WB-16: a query that is not a let block shows the line without a step, and a list shows no line', async ({ page }) => {
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill('#table({"A"}, {{1}, {2}})');
  await runButton(page).click();
  await expect(head(page).locator('.result-line')).toHaveText(/^2 rows · 1 column · \d+ ms$/);
  await editor(page).fill('{1, 2, 3}');
  await runButton(page).click();
  await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('1');
  await expect(head(page)).toBeHidden();
});

test('T-WB-16: the verdict chip says when the result matches the last Excel refresh and when it differs', async ({ page }) => {
  await openApp(page);
  await loadFile(page, ext('pq_vba_complex.xlsm'));
  await item(page, 'RawInput').click();
  await runButton(page).click();
  await expect(head(page).locator('.chip.ok')).toHaveText('Matches the last Excel refresh');
  const original = await editor(page).inputValue();
  await editor(page).fill(original.replace('in\n    #"Renamed Columns"', 'in\n    Table.TransformColumns(#"Renamed Columns", {{"RawInput", each Text.Lower(_)}})'));
  await runButton(page).click();
  await expect(head(page).locator('.chip.diff')).toHaveText('Differs from the last Excel refresh in 1 cells');
});

test('T-WB-16: Export from the Result tab saves the shown result, and with a view filter on it saves only the view', async ({ page }) => {
  await setupSteps(page);
  const whole = await download(page, 'CSV (UTF-8)');
  expect(whole.name).toBe('StudentResults.csv');
  expect(whole.text.trim().split(/\r?\n/)).toEqual(['Name,Age,City', 'Ann,30,Oslo', 'Bob,25,Rome', 'Cy,30,Oslo', 'Di,41,Paris', 'Ed,25,Rome', 'Flo,,Oslo']);
  await page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: 'City' }).first().click();
  await page.getByRole('menuitem', { name: 'Filter…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Filter City' });
  await dlg.getByRole('radio', { name: 'Condition' }).check();
  await dlg.locator('select').selectOption({ label: 'equals' });
  await dlg.getByLabel('Value', { exact: true }).fill('Oslo');
  await dlg.getByRole('button', { name: 'Filter the view' }).click();
  await expect(page.locator('.chip.view')).toContainText('3 of 6 rows');
  await page.locator('.result-actions').getByRole('button', { name: 'Get a file' }).click();
  await expect(page.getByText('This exports the view you see, not the whole result.')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'TSV' }).click()]);
  const view = readFileSync(await dl.path(), 'utf8');
  expect(view.trim().split(/\r?\n/)).toEqual(['Name\tAge\tCity', 'Ann\t30\tOslo', 'Cy\t30\tOslo', 'Flo\t\tOslo']);
});

test('T-WB-16: exporting a view with a hidden column leaves that column out', async ({ page }) => {
  await setupSteps(page);
  await page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: 'Age' }).first().click();
  await page.getByRole('menuitem', { name: 'Hide in view' }).click();
  await expect(page.locator('.chip.view')).toContainText('1 column hidden');
  const out = await download(page, 'CSV (UTF-8)');
  expect(out.text.trim().split(/\r?\n/)[0]).toBe('Name,City');
});
