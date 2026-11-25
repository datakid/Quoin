import { test, expect } from '@playwright/test';
import { fx, openApp, loadFile, item, editor } from './helpers.js';

const THREE = 'Table.Combine({Csv.Document(File.Contents("a.csv")), Csv.Document(File.Contents("b.csv")), Csv.Document(File.Contents("c.csv"))})';
const csv = (name) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('x,y\n1,2\n') });
const dlg = (page, name) => page.getByRole('dialog', { name });
const more = (page) => page.getByRole('button', { name: 'More actions' });

async function setup(page, text = THREE) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await loadFile(page, fx('csv-query.xlsx'));
  await item(page, 'Sales').click();
  await editor(page).fill(text);
}

async function openSources(page) {
  await more(page).click();
  await page.getByRole('menuitem', { name: 'Sources\u2026' }).click();
  await expect(dlg(page, 'Sources')).toBeVisible();
}

async function bind(page, d, key) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), d.getByRole('button', { name: `Choose file\u2026 for ${key}` }).click()]);
  await chooser.setFiles(csv(key));
}

test('T-WB-19: the Sources dialog lists each file with the query that uses it and binds and clears them', async ({ page }) => {
  await setup(page);
  await openSources(page);
  const d = dlg(page, 'Sources');
  await expect(d.locator('.source-row')).toHaveCount(3);
  await expect(d.locator('.source-key')).toHaveText(['a.csv', 'b.csv', 'c.csv']);
  await expect(d.locator('.source-row').first()).toContainText('Used by Sales');
  await expect(d.locator('.source-state')).toHaveText(['Not bound', 'Not bound', 'Not bound']);
  await bind(page, d, 'b.csv');
  await expect(d.locator('.source-row').nth(1).locator('.source-state')).toHaveText('Bound to b.csv');
  await d.getByRole('button', { name: 'Clear the file for b.csv' }).click();
  await expect(d.locator('.source-row').nth(1).locator('.source-state')).toHaveText('Not bound');
  await d.getByRole('button', { name: 'Close' }).click();
  await expect(d).toBeHidden();
});

test('T-WB-19: with three files bound up front, Run all asks no questions', async ({ page }) => {
  await setup(page);
  await openSources(page);
  const d = dlg(page, 'Sources');
  for (const k of ['a.csv', 'b.csv', 'c.csv']) await bind(page, d, k);
  await expect(d.locator('.source-state')).toHaveText(['Bound to a.csv', 'Bound to b.csv', 'Bound to c.csv']);
  await d.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Control+Alt+Enter');
  await expect(page.locator('#status')).toContainText('2 ran');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('T-WB-19: Run all with unbound files asks once, up front, and Cancel leaves everything as it was', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+Alt+Enter');
  const d = dlg(page, 'Some files are not bound yet');
  await expect(d).toBeVisible();
  await expect(d).toContainText('3 sources in this run have no file yet.');
  await expect(d.locator('.source-key')).toHaveText(['a.csv', 'b.csv', 'c.csv']);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await expect(page.locator('#status')).not.toContainText('ran');
});

test('T-WB-19: Run anyway runs the batch and the queries that lack a file end with the source error', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+Alt+Enter');
  await dlg(page, 'Some files are not bound yet').getByRole('button', { name: 'Run anyway' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('#status')).toContainText('1 failed', { timeout: 20000 });
});

test('T-WB-19: Bind them now opens Sources, and after the files are bound the run goes ahead without more questions', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+Alt+Enter');
  await dlg(page, 'Some files are not bound yet').getByRole('button', { name: 'Bind them now' }).click();
  const d = dlg(page, 'Sources');
  await expect(d).toBeVisible();
  for (const k of ['a.csv', 'b.csv', 'c.csv']) await bind(page, d, k);
  await d.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#status')).toContainText('2 ran', { timeout: 20000 });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('T-WB-19: a computed path and a database are listed with what happens, and offer no file to choose', async ({ page }) => {
  await setup(page, '{Csv.Document(File.Contents("a" & ".csv")), Sql.Database("srv", "db")}');
  await openSources(page);
  const d = dlg(page, 'Sources');
  await expect(d.locator('.source-row')).toHaveCount(2);
  await expect(d).toContainText('Chosen when the query runs');
  await expect(d).toContainText('The argument of File.Contents is built in M, so Quoin asks for the file when the query runs.');
  await expect(d).toContainText('Quoin cannot read what Sql.Database reaches in the browser');
  await expect(d.getByRole('button', { name: /^Choose file/ })).toHaveCount(0);
});

test('T-WB-19: a query with no file sources shows an empty list, and the palette opens Sources too', async ({ page }) => {
  await setup(page, '#table({"A"}, {{1}})');
  await openSources(page);
  await expect(dlg(page, 'Sources')).toContainText('No query reads a file or an address.');
  await dlg(page, 'Sources').getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('files and addresses');
  await page.keyboard.press('Enter');
  await expect(dlg(page, 'Sources')).toBeVisible();
});

test('T-WB-19: a file read only by an upstream query is asked for up front too', async ({ page }) => {
  await setup(page, 'Csv.Document(File.Contents("a.csv"))');
  await item(page, 'StudentResults').click();
  await editor(page).fill('Sales');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Run this query and everything that uses it');
  await page.keyboard.press('Enter');
  const d = dlg(page, 'Some files are not bound yet');
  await expect(d).toBeVisible();
  await expect(d).toContainText('1 source in this run has no file yet.');
  await expect(d.locator('.source-key')).toHaveText(['a.csv']);
  await expect(d).toContainText('Used by Sales');
  await d.getByRole('button', { name: 'Cancel' }).click();
});
