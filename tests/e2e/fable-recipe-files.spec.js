import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ext, fx } from './helpers.js';
import { openSet, give, panel, recipeInput, inject, NEW_M, previewButton, matrix } from './fable-batch.js';
import { parseRecipe, serialiseRecipe } from '../../src/batch/recipe/recipe.js';

const recipe = inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M });
const twoBooks = (page) => openSet(page, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);
const saveButton = (page) => page.getByRole('button', { name: 'Save recipe' });

test('fable recipe files: Save recipe is shown only while a recipe is held', async ({ page }) => {
  await twoBooks(page);
  await expect(saveButton(page)).toBeHidden();
  await give(page, recipe);
  await expect(saveButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(saveButton(page)).toBeHidden();
});

test('fable recipe files: saving writes the canonical recipe under the loaded name and loading it again gives the same recipe', async ({ page }, testInfo) => {
  await twoBooks(page);
  await give(page, recipe);
  const target = join(testInfo.outputPath('save'), 'saved.json');
  const [download] = await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  expect(download.suggestedFilename()).toBe('my.quoin-recipe.json');
  await download.saveAs(target);
  const text = readFileSync(target, 'utf8');
  expect(text).toBe(serialiseRecipe(parseRecipe(JSON.stringify(recipe)).recipe));
  expect(text.endsWith('}\n')).toBe(true);
  await give(page, text);
  await expect(panel(page)).toContainText('Inject · my.quoin-recipe.json');
  await expect(previewButton(page)).toBeEnabled();
});

test('fable recipe files: a recipe saved after a preview is the same recipe and the preview is kept', async ({ page }) => {
  await twoBooks(page);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  expect(download.suggestedFilename()).toBe('my.quoin-recipe.json');
  await expect(matrix(page)).toBeVisible();
});

test('fable recipe files: a binary file is refused in words and nothing is loaded', async ({ page }) => {
  await twoBooks(page);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
  await recipeInput(page).setInputFiles({ name: 'x.quoin-recipe.json', mimeType: 'application/json', buffer: png });
  await expect(panel(page)).toContainText('This is not a text file.');
  await expect(panel(page)).toContainText('No recipe loaded.');
  await expect(saveButton(page)).toBeHidden();
});

test('fable recipe files: a recipe file over 256 KB is refused before it is read', async ({ page }) => {
  await twoBooks(page);
  await recipeInput(page).setInputFiles({ name: 'big.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.alloc(256 * 1024 + 1, 32) });
  await expect(panel(page)).toContainText('This recipe file is larger than 256 KB and was not opened.');
});

test('fable recipe files: a file with a byte order mark and Windows line endings loads', async ({ page }) => {
  await twoBooks(page);
  const text = `\ufeff${JSON.stringify(recipe, null, 2).replace(/\n/g, '\r\n')}\r\n`;
  await recipeInput(page).setInputFiles({ name: 'bom.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
  await expect(panel(page)).toContainText('Inject · bom.quoin-recipe.json');
});

test('fable recipe files: a recipe that is not valid says where, and a newer one says so', async ({ page }) => {
  await twoBooks(page);
  await give(page, { recipe: 'inject', v: 1, inject: { target: 'query', op: 'rename', name: 'Q' } });
  await expect(panel(page)).toContainText('inject.newName');
  await give(page, { recipe: 'collect', v: 9 });
  await expect(panel(page)).toContainText('newer version');
});
