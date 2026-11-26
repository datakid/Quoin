import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ext, fx } from './helpers.js';
import { openSet, give, panel, recipeInput, inject, NEW_M, previewButton, matrix } from './fable-batch.js';
import { parseRecipe } from '../../src/batch/recipe/recipe.js';

const recipe = inject({ target: 'query', op: 'replace', name: 'StudentResults', text: NEW_M });
const twoBooks = (page) => openSet(page, [['mixed.xlsm', fx('mixed.xlsm')], ['pq_simple.xlsx', ext('pq_simple.xlsx')]]);
const downloadButton = (page) => page.getByRole('button', { name: 'Download recipe file' });

test('fable recipe files: Download recipe file is shown only while a recipe is held', async ({ page }) => {
  await twoBooks(page);
  await expect(downloadButton(page)).toBeHidden();
  await give(page, recipe);
  await expect(downloadButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(downloadButton(page)).toBeHidden();
});

test('fable recipe files: a recipe downloaded after a preview is the canonical text and the preview is kept', async ({ page }, testInfo) => {
  await twoBooks(page);
  await give(page, recipe);
  await previewButton(page).click();
  await expect(matrix(page)).toBeVisible();
  const target = join(testInfo.outputPath('save'), 'saved.json');
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
  await download.saveAs(target);
  const text = readFileSync(target, 'utf8');
  expect(parseRecipe(text).ok).toBe(true);
  expect(text.endsWith('}\n')).toBe(true);
  await expect(matrix(page)).toBeVisible();
});

test('fable recipe files: a binary file is refused in words and nothing is loaded', async ({ page }) => {
  await twoBooks(page);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
  await recipeInput(page).setInputFiles({ name: 'x.quoin-recipe.json', mimeType: 'application/json', buffer: png });
  await expect(panel(page)).toContainText('This is not a text file, so it was not opened as a recipe.');
  await expect(panel(page)).toContainText('No recipe loaded.');
  await expect(downloadButton(page)).toBeHidden();
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
