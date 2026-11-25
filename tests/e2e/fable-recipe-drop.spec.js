import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { openApp, dropTree, waitForSet, ext, setSnapshot } from './helpers.js';
import { inject, NEW_M, previewButton, getButton, matrix, panel, previewState } from './fable-batch.js';

const b64 = (path) => readFileSync(path).toString('base64');
const text = (json) => Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)).toString('base64');
const recipe = { ...inject({ target: 'query', op: 'add', name: 'Added', text: NEW_M }), name: 'Fix sales' };
const recipeNode = (json = recipe, name = 'fix.quoin-recipe.json') => ({ name, data: text(json) });
const simple = { name: 'pq_simple.xlsx', data: b64(ext('pq_simple.xlsx')) };
const complex = { name: 'pq_vba_complex.xlsm', data: b64(ext('pq_vba_complex.xlsm')) };
const folder = (...files) => ({ name: 'books', children: files });
const alert = (page) => page.locator('.status-alert, .empty .message, .recipe-panel .message');

test('fable recipe drop: a recipe and a folder together go straight to Preview', async ({ page }) => {
  const problems = await openApp(page);
  await dropTree(page, [folder(simple, complex), recipeNode()]);
  await expect(matrix(page)).toBeVisible();
  await expect(matrix(page).getByRole('row')).toHaveCount(3);
  await expect(panel(page)).toContainText('Inject · fix.quoin-recipe.json');
  await expect(panel(page)).toContainText('2 would change');
  await expect(getButton(page)).toBeEnabled();
  const snap = await setSnapshot(page);
  expect(snap.state).toBe('ready');
  expect(snap.files.map((f) => f.relPath)).toEqual(['books/pq_simple.xlsx', 'books/pq_vba_complex.xlsm']);
  expect(problems).toEqual([]);
});

test('fable recipe drop: the preview it makes says what the Preview button says', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [folder(simple, complex), recipeNode()]);
  await expect(matrix(page)).toBeVisible();
  const said = async () => {
    const state = await previewState(page);
    return JSON.stringify({ rows: state.rows.map(({ file, folder, unit, action, verdict, code, reason }) => ({ file, folder, unit, action, verdict, code, reason })), counts: state.counts, signedCount: state.signedCount });
  };
  const dropped = await said();
  expect(JSON.parse(dropped).counts.changed).toBe(2);
  await previewButton(page).click();
  await expect(page.locator('.recipe-notes')).toContainText('2 would change');
  expect(await said()).toBe(dropped);
});

test('fable recipe drop: loose workbooks and a recipe make a set, and so does one workbook with a recipe', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [simple, complex, recipeNode()]);
  await expect(matrix(page)).toBeVisible();
  await expect(matrix(page).getByRole('row')).toHaveCount(3);
  await page.reload();
  await openApp(page);
  await dropTree(page, [simple, recipeNode()]);
  await expect(matrix(page)).toBeVisible();
  await expect(page.locator('.workspace')).toHaveCount(0);
  await expect(panel(page)).toContainText('1 would change');
});

test('fable recipe drop: a recipe dropped onto a set adds the files and previews all of them', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [folder(simple)]);
  await waitForSet(page);
  await dropTree(page, [{ name: 'more', children: [complex] }, recipeNode()]);
  await expect(matrix(page)).toBeVisible();
  await expect(matrix(page).getByRole('row')).toHaveCount(3);
  expect((await setSnapshot(page)).files).toHaveLength(2);
});

test('fable recipe drop: a recipe alone loads when a set is open and is refused when none is', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [recipeNode()]);
  await expect(page.getByRole('alert').filter({ hasText: 'Drop the recipe together with the workbooks or a folder, or open a set first.' })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await dropTree(page, [folder(simple)]);
  await waitForSet(page);
  await dropTree(page, [recipeNode()]);
  await expect(panel(page)).toContainText('Inject · fix.quoin-recipe.json');
  await expect(matrix(page)).toBeHidden();
});

test('fable recipe drop: two recipes are refused and nothing is added', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [folder(simple), recipeNode(recipe, 'a.quoin-recipe.json'), recipeNode(recipe, 'b.quoin-recipe.json')]);
  await expect(page.getByRole('alert').filter({ hasText: 'Drop one recipe at a time.' })).toBeVisible();
  await expect(page.locator('.set-shell, .recipe-panel')).toHaveCount(0);
});

test('fable recipe drop: a recipe that cannot be read still opens the set, says why, and does not preview', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [folder(simple), recipeNode('{ not json')]);
  await waitForSet(page);
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(matrix(page)).toBeHidden();
  await expect(previewButton(page)).toBeDisabled();
});

test('fable recipe drop: a recipe that cannot be previewed yet is loaded and explained, not run', async ({ page }) => {
  const inPlace = { recipe: 'transform', v: 1, scope: { type: 'tables', match: 'all' }, query: { source: 'inline', m: 'let Source = 1 in Source' }, output: { mode: 'inPlace', range: 'A1' } };
  await openApp(page);
  await dropTree(page, [folder(simple), recipeNode(inPlace)]);
  await waitForSet(page);
  await expect(panel(page)).toContainText('Transform · fix.quoin-recipe.json');
  await expect(panel(page)).toContainText('cannot be previewed here yet');
  await expect(matrix(page)).toBeHidden();
});

test('fable recipe drop: a recipe inside a dropped folder is not taken as the recipe', async ({ page }) => {
  await openApp(page);
  await dropTree(page, [folder(simple, recipeNode())]);
  await waitForSet(page);
  await expect(panel(page)).toContainText('No recipe loaded.');
  await expect(matrix(page)).toBeHidden();
});
