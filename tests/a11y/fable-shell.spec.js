import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openApp, dropTree, waitForSet, ext, fx } from '../e2e/helpers.js';
import { SET_STATES, setUpSetState } from '../e2e/states.js';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function audit(page, label) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { region: { enabled: false } } }));
  const bad = result.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(bad).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  for (const state of SET_STATES) {
    test(`T-A11Y-FABLE: no axe violations in the set shell, ${state} state, ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openApp(page);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await setUpSetState(page, state);
      await audit(page, `${theme} ${state}`);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`T-A11Y-FABLE: no axe violations in the set shell with a file open, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const data = readFileSync(ext('pq_vba_complex.xlsm')).toString('base64');
    await dropTree(page, [{ name: 'books', children: [{ name: 'pq_vba_complex.xlsm', data }, { name: 'pq_simple.xlsx', data: readFileSync(ext('pq_simple.xlsx')).toString('base64') }] }]);
    await waitForSet(page);
    await page.locator('.set-file', { hasText: 'pq_vba_complex.xlsm' }).getByRole('button').click();
    await page.waitForSelector('.workspace');
    await audit(page, `${theme} file open`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`T-A11Y-FABLE: no axe violations with a result table, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await setUpSetState(page, 'done');
    await page.evaluate(() => {
      const verdicts = ['unchanged', 'changed', 'skipped', 'failed', 'refused'];
      const rows = verdicts.map((v, i) => ({ run_id: 'r', file: `b${i}.xlsx`, folder: 'east/', unit: 'b', unit_index: 1, recipe: 'collect', action: 'collect', compute: '', verdict: v, reason_code: '', reason: v === 'skipped' ? 'Skipped. Quoin opens .xlsx, .xlsm, .xltx and .xltm files.' : '', old_hash: 'a'.repeat(64), new_hash: 'b'.repeat(64), output: '', verified: true, signature_removed: false, duration_ms: 1 }));
      window.__quoin.shell.showResult(rows, 'report');
    });
    await page.waitForSelector('[role=grid]');
    await audit(page, `${theme} matrix`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`T-A11Y-FABLE: no axe violations in the versions panel with a diff, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const data = readFileSync(ext('pq_vba_complex.xlsm')).toString('base64');
    const other = readFileSync(ext('pq_simple.xlsx')).toString('base64');
    await dropTree(page, [{ name: 'books', children: [{ name: 'a.xlsm', data }, { name: 'b.xlsx', data: other }] }]);
    await waitForSet(page);
    await page.locator('.variant-item summary').first().click();
    await page.locator('.variant-version').first().waitFor();
    await audit(page, `${theme} versions`);
  });
}

for (const theme of ['light', 'dark']) {
  test(`T-A11Y-FABLE: no axe violations in the recipe panel with a preview and with an error, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await dropTree(page, [{ name: 'books', children: [{ name: 'mixed.xlsm', data: readFileSync(fx('mixed.xlsm')).toString('base64') }, { name: 'pq_simple.xlsx', data: readFileSync(ext('pq_simple.xlsx')).toString('base64') }] }]);
    await waitForSet(page);
    const recipe = { recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true, shiny: true } };
    await page.locator('input[aria-label="Recipe file"]').setInputFiles({ name: 'my.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForSelector('[role=grid]');
    await audit(page, `${theme} preview`);
    await page.locator('input[aria-label="Recipe file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await page.waitForSelector('.recipe-error:not([hidden])');
    await audit(page, `${theme} recipe error`);
  });
}
