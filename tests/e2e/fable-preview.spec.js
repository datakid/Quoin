import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ext, fx, openApp, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const NEW_M = 'let\n    Source = 2\nin\n    Source';

const replaceCode = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true } };
const injectReplace = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: NEW_M, refreshOnLoad: false } };
const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };

const recipeInput = (page) => page.locator('input[aria-label="Recipe file"]');
const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
const previewButton = (page) => page.getByRole('button', { name: 'Preview', exact: true });
const loadButton = (page) => page.getByRole('button', { name: 'Load recipe', exact: true });
const panel = (page) => page.locator('.recipe-panel');

const give = (page, json, name = 'my.quoin-recipe.json') => recipeInput(page).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)) });

async function openSet(page, files) {
  const problems = await openApp(page);
  await dropTree(page, [{ name: 'books', children: files.map(([name, path]) => ({ name, data: b64(path) })) }]);
  await waitForSet(page);
  return problems;
}

const twoBooks = (page) => openSet(page, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);

test('fable preview: loading a recipe shows its kind and name, and Preview shows what would change without any download', async ({ page }) => {
  const problems = await twoBooks(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await expect(previewButton(page)).toBeDisabled();
  await expect(panel(page)).toContainText('No recipe loaded.');
  await give(page, replaceCode);
  await expect(panel(page)).toContainText('Replace in code · my.quoin-recipe.json');
  await expect(previewButton(page)).toBeEnabled();
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await expect(matrix(page).locator('.grid-hcell .hname')).toHaveText(['File', 'Unit', 'Action', 'Compute', 'Would change', 'Reason', 'Old hash', 'New hash']);
  await expect(panel(page).locator('.recipe-notes')).toContainText(/\d+ would change/);
  const rows = await page.evaluate(() => window.__quoin.shell.matrix.grid.rowCount);
  expect(rows).toBeGreaterThan(0);
  await expect(matrix(page).locator('.grid-row', { hasText: 'mixed.xlsm' }).filter({ hasText: 'Yes' })).not.toHaveCount(0);
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
  expect(downloads).toBe(0);
  expect(problems).toEqual([]);
});

test('fable preview: refused and skipped rows read in words, not codes', async ({ page }) => {
  await twoBooks(page);
  await give(page, moduleReplace);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const text = await matrix(page).innerText();
  expect(text).toContain('Nothing in this file matches the recipe. The file was left as it is.');
  expect(text).not.toMatch(/skip\.notApplicable|refused\.[a-z]/i);
});

test('fable preview: the signature notice names how many signed files would lose it', async ({ page }) => {
  await openSet(page, [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]]);
  await give(page, moduleReplace);
  await previewButton(page).click();
  await expect(panel(page).locator('.recipe-notes')).toContainText('1 file has a signed macro project. Running removes the signature.');
});

test('fable preview: a recipe that is not valid says why and leaves Preview off', async ({ page }) => {
  await twoBooks(page);
  await give(page, replaceCode);
  await expect(previewButton(page)).toBeEnabled();
  await give(page, '{"recipe":"inject","v":1}');
  await expect(panel(page).locator('.recipe-error')).toContainText('This recipe could not be read.');
  await expect(previewButton(page)).toBeDisabled();
  await expect(panel(page)).toContainText('No recipe loaded.');
  await give(page, 'not json');
  await expect(panel(page).locator('.recipe-error')).toContainText('not valid JSON');
  await give(page, { recipe: 'inject', v: 9 });
  await expect(panel(page).locator('.recipe-error')).toHaveText('This recipe is from a newer version of Quoin and was not opened.');
});

test('fable preview: a recipe file over 256 KB is refused before it is read', async ({ page }) => {
  await twoBooks(page);
  await give(page, ' '.repeat(256 * 1024 + 1));
  await expect(panel(page).locator('.recipe-error')).toHaveText('This recipe file is larger than 256 KB and was not opened.');
  await expect(previewButton(page)).toBeDisabled();
});

test('fable preview: unknown fields are listed as notes and the recipe still previews', async ({ page }) => {
  await twoBooks(page);
  await give(page, { ...replaceCode, replace: { ...replaceCode.replace, shiny: true } });
  await expect(panel(page).locator('.recipe-warnings')).toContainText('Unknown field replace.shiny was ignored.');
  await expect(previewButton(page)).toBeEnabled();
});

test('fable preview: a collect recipe loads but cannot be previewed here yet', async ({ page }) => {
  await twoBooks(page);
  await give(page, { recipe: 'collect', v: 1 });
  await expect(panel(page)).toContainText('Collect · my.quoin-recipe.json');
  await expect(panel(page).locator('.recipe-notes')).toContainText('This kind of recipe cannot be previewed here yet.');
  await expect(previewButton(page)).toBeDisabled();
});

test('fable preview: a recipe the set cannot use shows the first problem in words and changes nothing', async ({ page }) => {
  await twoBooks(page);
  await give(page, { ...replaceCode, output: { mode: 'newFile', name: '{nope}' } });
  await previewButton(page).click();
  await expect(panel(page).locator('.recipe-error')).toHaveText('Unknown token {nope}. The tokens are {file.name}, {file.folder}, {unit.name}, {unit.index}.');
  await expect(matrix(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__quoin.set.state)).toBe('ready');
});

test('fable preview: removing the recipe or loading another one clears the preview', async ({ page }) => {
  await twoBooks(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(matrix(page)).toHaveCount(0);
  await expect(panel(page)).toContainText('No recipe loaded.');
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await give(page, injectReplace);
  await expect(matrix(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__quoin.preview)).toBe(null);
});

test('fable preview: adding files after a preview clears it, so a stale table is never shown', async ({ page }) => {
  await twoBooks(page);
  await give(page, replaceCode);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await dropTree(page, [{ name: 'more', children: [{ name: 'extra.xlsx', data: b64(ext('pq_simple.xlsx')) }] }]);
  await waitForSet(page);
  await expect(matrix(page)).toHaveCount(0);
  await expect(panel(page).locator('.recipe-notes')).toBeHidden();
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
});

test('fable preview: Cancel stops a preview, shows nothing, and Preview works again', async ({ page }) => {
  await openApp(page);
  const data = b64(ext('pq_simple.xlsx'));
  await dropTree(page, [{ name: 'many', children: Array.from({ length: 80 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.xlsx`, data })) }]);
  await waitForSet(page);
  await give(page, injectReplace);
  await page.evaluate(() => {
    window.__quoinPreview = window.__quoin.previewRecipe();
    window.__quoin.cancelSetRun();
  });
  await page.waitForFunction(() => window.__quoin.set.state === 'ready');
  await expect(matrix(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__quoin.preview)).toBe(null);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const rows = await page.evaluate(() => window.__quoin.shell.matrix.grid.rowCount);
  expect(rows).toBe(80);
});

test('fable preview: the whole flow works from the keyboard and focus returns to Preview', async ({ page }) => {
  await twoBooks(page);
  await give(page, replaceCode);
  await previewButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(matrix(page)).toBeVisible();
  await expect(previewButton(page)).toBeEnabled();
  await expect(previewButton(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Remove recipe' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(loadButton(page)).toBeFocused();
});

test('fable preview: while a file is open the recipe panel is hidden and it returns when you go back', async ({ page }) => {
  await twoBooks(page);
  await give(page, replaceCode);
  await page.locator('.set-file', { hasText: 'pq_simple.xlsx' }).getByRole('button').click();
  await page.waitForSelector('.workspace');
  await expect(panel(page)).toBeHidden();
  await page.getByRole('button', { name: 'All files' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Replace in code · my.quoin-recipe.json');
});
