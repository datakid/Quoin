import { test, expect } from '@playwright/test';
import { ext } from './helpers.js';
import { openSet, give, previewButton, matrix, panel } from './fable-batch.js';

const book = [['pq_simple.xlsx', ext('pq_simple.xlsx')]];
const CURRENT = 'Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]';
const transform = (name, m = CURRENT) => ({ recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m }, output: { mode: 'newFile', name } });
const tokens = (page) => panel(page).locator('.recipe-tokens');
const names = (page) => tokens(page).locator('.recipe-token-name');

test('fable tokens: the Tokens list appears with a recipe, closed at first, and names all four tokens', async ({ page }) => {
  await openSet(page, book);
  await expect(tokens(page)).toBeHidden();
  await give(page, transform('{file.name}__{unit.name}.xlsx'));
  await expect(tokens(page)).toBeVisible();
  await expect(tokens(page)).not.toHaveAttribute('open', '');
  await tokens(page).locator('summary').click();
  await expect(names(page)).toHaveText(['{file.name}', '{file.folder}', '{unit.name}', '{unit.index}']);
  await expect(tokens(page).locator('.recipe-token-what').first()).toContainText('without its extension');
});

test('fable tokens: the tokens the loaded recipe uses are marked in words, in the query text and in the output name', async ({ page }) => {
  await openSet(page, book);
  await give(page, transform('{file.name}__{unit.index}.xlsx'));
  await tokens(page).locator('summary').click();
  const marked = tokens(page).locator('.recipe-token', { has: page.locator('.recipe-token-used') });
  await expect(marked.locator('.recipe-token-name')).toHaveText(['{file.name}', '{unit.name}', '{unit.index}']);
  await expect(marked.first()).toContainText('in use in this recipe');
  await give(page, transform(undefined, '1'));
  await expect(tokens(page).locator('.recipe-token-used')).toHaveCount(0);
});

test('fable tokens: an unknown token is noted when the recipe loads and refused by Preview with the valid tokens named', async ({ page }) => {
  await openSet(page, book);
  await give(page, transform('{date}-{file.name}.xlsx'));
  await expect(panel(page).locator('.recipe-warnings')).toContainText('Unknown token {date}. Preview will not run this recipe.');
  await previewButton(page).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Unknown token {date}. The tokens are {file.name}, {file.folder}, {unit.name}, {unit.index}.');
  await expect(matrix(page)).toBeHidden();
});

test('fable tokens: several unknown tokens are each noted and Preview counts the rest', async ({ page }) => {
  await openSet(page, book);
  await give(page, transform('{date}-{time}.xlsx', 'let a = "{unit.nam}" in a'));
  await expect(panel(page).locator('.recipe-warnings li')).toHaveText([
    'Unknown token {date}. Preview will not run this recipe.',
    'Unknown token {time}. Preview will not run this recipe.',
    'Unknown token {unit.nam}. Preview will not run this recipe.'
  ]);
  await previewButton(page).click();
  await expect(panel(page).getByRole('alert')).toContainText('Unknown token {date}. 2 more problems with this recipe. The tokens are');
});

test('fable tokens: a recipe with only known tokens has no token note and previews', async ({ page }) => {
  await openSet(page, book);
  await give(page, transform('{file.name}__{unit.name}.xlsx'));
  await expect(panel(page).locator('.recipe-warnings')).toBeHidden();
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
});

test('fable tokens: Copy puts the token on the clipboard and says so', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  else await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } } });
  });
  await openSet(page, book);
  await give(page, transform('{file.name}.xlsx'));
  await tokens(page).locator('summary').click();
  await page.getByRole('button', { name: 'Copy {unit.name}', exact: true }).click();
  await expect(tokens(page).getByRole('status')).toHaveText('Copied {unit.name}.');
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('{unit.name}');
  else expect(await page.evaluate(() => window.__copied)).toEqual(['{unit.name}']);
});

test('fable tokens: the token list is reachable from the keyboard', async ({ page }) => {
  await openSet(page, book);
  await give(page, transform('{file.name}.xlsx'));
  await tokens(page).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(names(page).first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Copy {file.name}', exact: true })).toBeFocused();
});
