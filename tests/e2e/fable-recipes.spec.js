import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';
import { ext } from './helpers.js';
import { openSet, give, inject, NEW_M, recipeInput, previewButton, matrix, panel } from './fable-batch.js';

const book = [['pq_simple.xlsx', ext('pq_simple.xlsx')]];
const recipe = { ...inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M }), name: 'Fix sales' };
const saveButton = (page) => page.getByRole('button', { name: 'Save in this browser', exact: true });
const downloadButton = (page) => page.getByRole('button', { name: 'Download recipe file', exact: true });
const stored = (page) => page.locator('.recipe-stored');
const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort());
const value = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

test('fable recipes: Save and Download appear only once a recipe is loaded', async ({ page }) => {
  await openSet(page, book);
  await expect(saveButton(page)).toBeHidden();
  await expect(downloadButton(page)).toBeHidden();
  await expect(stored(page)).toBeHidden();
  await give(page, recipe);
  await expect(saveButton(page)).toBeVisible();
  await expect(downloadButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(saveButton(page)).toBeHidden();
});

test('fable recipes: a saved recipe is listed, survives a reload, and Use loads it so it can be previewed', async ({ page }) => {
  await openSet(page, book);
  await give(page, recipe);
  await saveButton(page).click();
  await expect(panel(page).locator('.recipe-kept')).toHaveText('Saved Fix sales in this browser.');
  await expect(stored(page).getByRole('listitem')).toHaveText(/Inject · Fix sales/);
  const entries = await value(page, 'quoin.recipes');
  expect(entries).toHaveLength(1);
  expect(entries[0].name).toBe('Fix sales');
  expect(parseRecipe(entries[0].text).recipe).toEqual(parseRecipe(JSON.stringify(recipe)).recipe);

  await page.reload();
  await openSet(page, book);
  await expect(panel(page).locator('.recipe-line')).toHaveText('No recipe loaded.');
  await expect(stored(page).getByRole('listitem')).toHaveText(/Inject · Fix sales/);
  await page.getByRole('button', { name: 'Use Fix sales' }).click();
  await expect(panel(page).locator('.recipe-line')).toHaveText('Inject · Fix sales');
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  await expect(panel(page).locator('.recipe-notes')).toContainText('1 would change');
});

test('fable recipes: a recipe with no name is saved under its file name, and saving again replaces it', async ({ page }) => {
  const unnamed = inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M });
  await openSet(page, book);
  await give(page, unnamed);
  await saveButton(page).click();
  await expect(panel(page).locator('.recipe-kept')).toHaveText('Saved my in this browser.');
  await saveButton(page).click();
  expect(await value(page, 'quoin.recipes')).toHaveLength(1);
  await expect(stored(page).getByRole('listitem')).toHaveCount(1);
});

test('fable recipes: Download writes the recipe as a named file that loads back to the same recipe', async ({ page }) => {
  await openSet(page, book);
  await give(page, recipe);
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
  expect(download.suggestedFilename()).toBe('Fix sales.quoin-recipe.json');
  const text = readFileSync(await download.path(), 'utf8');
  expect(parseRecipe(text).recipe).toEqual(parseRecipe(JSON.stringify(recipe)).recipe);
  await expect(panel(page).locator('.recipe-kept')).toHaveText('Downloaded Fix sales.quoin-recipe.json.');
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await recipeInput(page).setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(panel(page).locator('.recipe-line')).toHaveText('Inject · Fix sales.quoin-recipe.json');
  expect(await keys(page)).not.toContain('quoin.recipes');
});

test('fable recipes: Delete removes a saved recipe and moves focus on, to the next one or to Load recipe', async ({ page }) => {
  await openSet(page, book);
  await give(page, recipe);
  await saveButton(page).click();
  await give(page, { ...recipe, name: 'Second' });
  await saveButton(page).click();
  await expect(stored(page).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete Fix sales' }).click();
  await expect(stored(page).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Use Second' })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Second' }).click();
  await expect(stored(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Load recipe', exact: true })).toBeFocused();
  expect(await value(page, 'quoin.recipes')).toEqual([]);
});

test('fable recipes: a stored entry that cannot be read is left out and the rest still list', async ({ page }) => {
  await openSet(page, book);
  await give(page, recipe);
  await saveButton(page).click();
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('quoin.recipes'));
    list.push({ name: 'Broken', text: '{not json' });
    localStorage.setItem('quoin.recipes', JSON.stringify(list));
  });
  await page.reload();
  await openSet(page, book);
  await expect(stored(page).getByRole('listitem')).toHaveCount(1);
  await expect(stored(page)).toContainText('1 saved recipe could not be read and is left out.');
});

test('fable recipes: a file that is not text is refused in words, and a file over 256 KB is still refused', async ({ page }) => {
  await openSet(page, book);
  await recipeInput(page).setInputFiles({ name: 'x.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 1]) });
  await expect(panel(page).locator('.recipe-error')).toHaveText('This is not a text file, so it was not opened as a recipe.');
  await recipeInput(page).setInputFiles({ name: 'big.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.alloc(300 * 1024, 32) });
  await expect(panel(page).locator('.recipe-error')).toHaveText('This recipe file is larger than 256 KB and was not opened.');
  await expect(saveButton(page)).toBeHidden();
});

test('fable recipes: after use, local storage holds only the theme and recipe text, never a path, a workbook or a query from one', async ({ page }) => {
  await openSet(page, book);
  await give(page, recipe);
  await saveButton(page).click();
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  expect((await keys(page)).filter((k) => k !== 'quoin.theme')).toEqual(['quoin.recipes']);
  const raw = await page.evaluate(() => localStorage.getItem('quoin.recipes'));
  expect(raw).not.toContain('pq_simple');
  expect(raw).not.toContain('books');
  expect(raw).not.toContain('StudentNames');
});
