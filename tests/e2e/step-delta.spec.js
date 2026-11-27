import { test, expect } from '@playwright/test';
import { ext, openApp, loadFile, item, editor, openSettings } from './helpers.js';

const QUERY = [
  'let',
  '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}, {"Di", 41, "Paris"}, {"Ed", 25, "Rome"}, {"Flo", 33, "Oslo"}}),',
  '    Typed = Table.TransformColumnTypes(Source, {{"Age", Int64.Type}}),',
  '    Oslo = Table.SelectRows(Typed, each [City] = "Oslo"),',
  '    Added = Table.AddColumn(Oslo, "Flag", each true),',
  '    Renamed = Table.RenameColumns(Added, {{"Name", "Who"}, {"City", "Town"}}),',
  '    Same = Table.Sort(Renamed, {{"Who", Order.Ascending}}),',
  '    Listed = Table.Column(Same, "Who")',
  'in',
  '    Listed'
].join('\n');

test('T-WB-14: every step shows what it changed: rows, columns, renames, types, schema same, and the kind of a list', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(QUERY);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(7);
  const chips = await page.locator('.step-row .step-delta').allTextContents();
  expect(chips).toEqual(['6 rows', '1 type', '\u22123 rows', '+1 col', 'renamed 2', 'schema same', 'list 3']);
});

test('T-WB-14: a step that changes rows and columns shows both, and the title carries a third change', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  const text = [
    'let',
    '    Source = #table({"A", "B"}, {{1, "x"}, {2, "y"}, {3, "z"}}),',
    '    Many = Table.SelectRows(Table.AddColumn(Table.TransformColumnTypes(Source, {{"A", Int64.Type}}), "C", each 1), each [A] > 1)',
    'in',
    '    Many'
  ].join('\n');
  await editor(page).fill(text);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(2);
  const chip = page.locator('.step-row .step-delta').nth(1);
  await expect(chip).toHaveText('\u22121 row \u00b7 +1 col');
  await expect(chip).toHaveAttribute('title', '\u22121 row \u00b7 +1 col \u00b7 1 type');
});

async function evaluated(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(QUERY);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(7);
}

test('T-WB-14: hovering a step for a moment peeks at its schema and first five rows without moving the cursor', async ({ page }) => {
  await evaluated(page);
  const current = await page.locator('.step-row.is-current').textContent();
  await page.locator('.step-row', { hasText: 'Typed' }).hover();
  const peek = page.locator('.step-peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('Peek at Typed');
  await expect(peek.locator('thead th')).toHaveCount(3);
  await expect(peek.locator('tbody tr')).toHaveCount(5);
  await expect(peek).toContainText('1 more row');
  expect(await page.locator('.step-row.is-current').textContent()).toBe(current);
  await page.mouse.move(5, 5);
  await expect(peek).toBeHidden();
});

test('T-WB-14: focusing a step peeks at it too, Escape closes the peek, and a list step has none', async ({ page }) => {
  await evaluated(page);
  await page.locator('.step-row', { hasText: 'Oslo' }).focus();
  const peek = page.locator('.step-peek');
  await expect(peek).toBeVisible();
  await expect(peek.locator('tbody tr')).toHaveCount(3);
  await expect(peek).not.toContainText('more row');
  await page.keyboard.press('Escape');
  await expect(peek).toBeHidden();
  await page.locator('.step-row', { hasText: 'Listed' }).focus();
  await page.waitForTimeout(700);
  await expect(peek).toHaveCount(0);
});

test('T-WB-14: Pin this result in a step menu pins that step, not the one shown', async ({ page }) => {
  await evaluated(page);
  await page.locator('.step-item', { hasText: 'Typed' }).getByRole('button', { name: /^Actions for step/ }).click();
  await page.getByRole('menuitem', { name: 'Pin this result' }).click();
  await expect(page.getByRole('tab', { name: /^Pinned/ }).locator('.dock-count')).toHaveText('1');
  await page.getByRole('tab', { name: /^Pinned/ }).click();
  await expect(page.locator('.dock-panel[data-panel=pinned]')).toContainText('Typed');
  await page.locator('.step-item', { hasText: 'Typed' }).getByRole('button', { name: /^Actions for step/ }).click();
  await page.getByRole('menuitem', { name: 'Pin this result' }).click();
  await expect(page.getByRole('tab', { name: /^Pinned/ }).locator('.dock-count')).toHaveText('1');
});

test('T-WB-14: Pin this result is disabled for a step with no table result', async ({ page }) => {
  await evaluated(page);
  await page.locator('.step-item', { hasText: 'Listed' }).getByRole('button', { name: /^Actions for step/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Pin this result' })).toBeDisabled();
});

async function setSetting(page, label, on) {
  await openSettings(page);
  const box = page.getByRole('dialog', { name: 'Settings' }).getByLabel(label);
  if (on) await box.check();
  else await box.uncheck();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save' }).click();
}

test('T-WB-14: with Count rows for every step off, the chips say rows are not counted and report only schema changes', async ({ page }) => {
  await evaluated(page);
  await setSetting(page, 'Count rows for every step', false);
  const chips = await page.locator('.step-row .step-delta').allTextContents();
  expect(chips).toEqual(['rows not counted', '1 type', 'schema same', '+1 col', 'renamed 2', 'schema same', 'list 3']);
  await setSetting(page, 'Count rows for every step', true);
  const back = await page.locator('.step-row .step-delta').allTextContents();
  expect(back[0]).toBe('6 rows');
});

const SHORT = [
  'let',
  '    Source = #table({"Name", "City"}, {{"Ann", "Oslo"}, {"Bob", "Rome"}, {"Cy", "Oslo"}, {"Di", "Paris"}}),',
  '    Oslo = Table.SelectRows(Source, each [City] = "Oslo"),',
  '    Flag = Table.AddColumn(Oslo, "Flag", each true)',
  'in',
  '    Flag'
].join('\n');

async function shortSetup(page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await item(page, 'StudentResults').click();
  await editor(page).fill(SHORT);
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.bead-ok')).toHaveCount(3);
  await expect(page.locator('.result-line')).toContainText('2 rows');
}

const applyPreview = async (page) => {
  await expect(page.locator('.step-preview')).toBeVisible();
  await page.locator('.step-preview').getByRole('button', { name: 'Apply' }).click();
};

test('T-WB-15: without Auto-run the result stays as it was after a structural edit, and a manual run brings it up to date', async ({ page }) => {
  await shortSetup(page);
  await page.locator('.step-row', { hasText: 'Oslo' }).focus();
  await page.keyboard.press('Delete');
  await applyPreview(page);
  await expect(page.locator('.step-row')).toHaveCount(2);
  await page.waitForTimeout(500);
  await expect(page.locator('.result-line')).toContainText('2 rows');
  await page.getByRole('button', { name: 'Evaluate steps' }).click();
  await expect(page.locator('.result-line')).toContainText('4 rows');
});

test('T-WB-15: with Auto-run on, a structural edit, its Undo and a restore run the steps again by themselves', async ({ page }) => {
  await shortSetup(page);
  await setSetting(page, 'Run the steps again after structural edits', true);
  await page.locator('.step-row', { hasText: 'Oslo' }).focus();
  await page.keyboard.press('Delete');
  await applyPreview(page);
  await expect(page.locator('.step-row')).toHaveCount(2);
  await expect(page.locator('.result-line')).toContainText('4 rows');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('.step-row')).toHaveCount(3);
  await expect(page.locator('.result-line')).toContainText('2 rows');
});
