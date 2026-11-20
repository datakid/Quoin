import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openWorkbook } from '../../src/core/workbook.js';
import { buildWorkbook } from '../../src/core/save.js';
import { checkSection } from '../../src/core/m/engine.js';
import { fx, openApp, dropTree, waitForSet } from './helpers.js';

const original = new Uint8Array(readFileSync(fx('mixed.xlsm')));

async function variant(note) {
  if (!note) return original;
  const wb = await openWorkbook(original, 'mixed.xlsm');
  const q = wb.queries.find((x) => x.name === 'RawInput');
  const res = await buildWorkbook(wb, { queryEdits: new Map([['RawInput', `${q.original}\n// ${note}`]]), checkSection });
  return res.bytes;
}

const b64 = (u8) => Buffer.from(u8).toString('base64');

async function dropVariants(page, layout) {
  const children = [];
  for (const [name, note] of layout) children.push({ name, data: b64(await variant(note)) });
  await openApp(page);
  await dropTree(page, [{ name: 'east', children }]);
  await waitForSet(page);
}

const SIX = [['a1.xlsm', null], ['a2.xlsm', null], ['a3.xlsm', null], ['b1.xlsm', 'editA'], ['b2.xlsm', 'editA'], ['c1.xlsm', 'editB']];
const item = (page, name) => page.locator('.variant-item', { has: page.locator('.variant-name', { hasText: new RegExp(`^${name}$`) }) });

test('fable variants: names that differ come first with the file and version counts', async ({ page }) => {
  await dropVariants(page, SIX);
  await expect(page.locator('.variants-lead')).toHaveText('1 name differs between files.');
  await expect(page.locator('.variant-item').first().locator('.variant-name')).toHaveText('RawInput');
  await expect(page.locator('.variant-item').first().locator('.variant-summary')).toHaveText('6 files, 3 versions');
  await expect(item(page, 'FinalTable').locator('.variant-summary')).toHaveText('6 files, 1 version');
  await expect(item(page, 'Module1').locator('.variant-kind')).toHaveText('Module');
  await expect(page.locator('.variant[data-drift=true]')).toHaveCount(1);
});

test('fable variants: versions are listed by file count and the most common is marked', async ({ page }) => {
  await dropVariants(page, SIX);
  const raw = item(page, 'RawInput');
  await raw.locator('summary').click();
  await expect(raw.locator('.variant-version')).toHaveText(['Version 1 · 3 files · most common', 'Version 2 · 2 files', 'Version 3 · 1 file']);
});

test('fable variants: choosing a version shows its diff against the most common one and the files that have it', async ({ page }) => {
  await dropVariants(page, SIX);
  const raw = item(page, 'RawInput');
  await raw.locator('summary').click();
  await raw.getByRole('button', { name: /^Version 2/ }).click();
  await expect(raw.getByRole('button', { name: /^Version 2/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(raw.locator('.diff-add .diff-text')).toHaveText('// editA');
  await expect(raw.locator('.variant-files')).toHaveText('Files: east/b1.xlsm, east/b2.xlsm');
  await raw.getByRole('button', { name: /^Version 3/ }).click();
  await expect(raw.locator('.diff-add .diff-text')).toHaveText('// editB');
  await expect(raw.locator('.variant-files')).toHaveText('Files: east/c1.xlsm');
  await raw.getByRole('button', { name: /^Version 1/ }).click();
  await expect(raw.locator('.variant-diff')).toContainText('This is the most common version.');
  await expect(raw.locator('.variant-files')).toHaveText('Files: east/a1.xlsm, east/a2.xlsm, east/a3.xlsm');
});

test('fable variants: a name with one version has no diff to show', async ({ page }) => {
  await dropVariants(page, SIX);
  const final = item(page, 'FinalTable');
  await final.locator('summary').click();
  await final.getByRole('button', { name: /^Version 1/ }).click();
  await expect(final.locator('.variant-diff')).toContainText('This is the most common version.');
  await expect(final.locator('.diff')).toHaveCount(0);
});

test('fable variants: a set with no differences says so', async ({ page }) => {
  await dropVariants(page, [['a1.xlsm', null], ['a2.xlsm', null]]);
  await expect(page.locator('.variants-lead')).toHaveText('Every query and module is the same in every file.');
  await expect(page.locator('.variant[data-drift=true]')).toHaveCount(0);
  await expect(page.locator('.variant-item').first().locator('.variant-summary')).toHaveText('2 files, 1 version');
});

test('fable variants: the panel keeps its open item while files are added and goes away while a file is open', async ({ page }) => {
  await dropVariants(page, SIX);
  const raw = item(page, 'RawInput');
  await raw.locator('summary').click();
  await raw.getByRole('button', { name: /^Version 2/ }).click();
  await expect(raw.locator('.diff-add')).toHaveCount(1);
  await page.locator('.set-file', { hasText: 'a1.xlsm' }).getByRole('button').click();
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('.variants')).toBeHidden();
  await page.getByRole('button', { name: 'All files' }).click();
  await expect(page.locator('.variants')).toBeVisible();
  await expect(item(page, 'RawInput').locator('.diff-add .diff-text')).toHaveText('// editA');
});

test('fable variants: the keyboard opens a name and chooses a version', async ({ page }) => {
  await dropVariants(page, SIX);
  const raw = item(page, 'RawInput');
  await raw.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(raw.locator('.variant-version').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(raw.locator('.variant-version').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(raw.locator('.diff-add .diff-text')).toHaveText('// editA');
});
