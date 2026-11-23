import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, dropTree, waitForSet, ext } from './helpers.js';
import { SET_STATES, setUpSetState, settle } from './states.js';

const VIEWS = [
  { size: '1280x800', width: 1280, height: 800, theme: 'light' },
  { size: '1280x800', width: 1280, height: 800, theme: 'dark' },
  { size: '390x844', width: 390, height: 844, theme: 'light' }
];

for (const state of SET_STATES) {
  for (const view of VIEWS) {
    test(`T-I-04-FABLE: set shell ${state} at ${view.size} in the ${view.theme} theme`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.theme, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await openApp(page);
      await setUpSetState(page, state);
      await settle(page);
      await expect(page).toHaveScreenshot(`fable-shell-${state}-${view.size}-${view.theme}.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
      await ctx.close();
    });
  }
}

for (const view of VIEWS) {
  test(`T-I-04-FABLE: set shell with a file open at ${view.size} in the ${view.theme} theme`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await openApp(page);
    const b64 = (name) => readFileSync(ext(name)).toString('base64');
    await dropTree(page, [{ name: 'books', children: [{ name: 'pq_vba_complex.xlsm', data: b64('pq_vba_complex.xlsm') }, { name: 'pq_simple.xlsx', data: b64('pq_simple.xlsx') }] }]);
    await waitForSet(page);
    await page.locator('.set-file', { hasText: 'pq_vba_complex.xlsm' }).getByRole('button').click();
    await page.waitForSelector('.workspace');
    await settle(page);
    await expect(page).toHaveScreenshot(`fable-shell-file-open-${view.size}-${view.theme}.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
    await ctx.close();
  });
}

for (const view of VIEWS.slice(0, 2)) {
  test(`T-I-04-FABLE: set shell with a result table at ${view.size} in the ${view.theme} theme`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await openApp(page);
    await setUpSetState(page, 'doneWithFailures');
    await page.evaluate(() => {
      const verdicts = ['unchanged', 'changed', 'skipped', 'failed', 'refused', 'cancelled', 'not-released'];
      const rows = verdicts.map((v, i) => ({ run_id: 'r', file: `book${i + 1}.xlsx`, folder: 'east/', unit: `book${i + 1}`, unit_index: 1, recipe: 'collect', action: 'collect', compute: '', verdict: v, reason_code: '', reason: v === 'skipped' || v === 'refused' ? 'Skipped. Quoin opens .xlsx, .xlsm, .xltx and .xltm files.' : '', old_hash: `${i}`.repeat(64), new_hash: `${i + 1}`.repeat(64), output: '', verified: true, signature_removed: false, duration_ms: 1 }));
      window.__quoin.shell.showResult(rows, 'report');
    });
    await settle(page);
    await expect(page).toHaveScreenshot(`fable-shell-matrix-${view.size}-${view.theme}.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
    await ctx.close();
  });
}

for (const view of VIEWS) {
  test(`T-I-04-FABLE: set shell with a recipe previewed and Get offered at ${view.size} in the ${view.theme} theme`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, colorScheme: view.theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await openApp(page);
    const b64 = (name) => readFileSync(ext(name)).toString('base64');
    await dropTree(page, [{ name: 'books', children: [{ name: 'pq_simple.xlsx', data: b64('pq_simple.xlsx') }, { name: 'pq_vba_complex.xlsm', data: b64('pq_vba_complex.xlsm') }] }]);
    await waitForSet(page);
    const recipe = { recipe: 'inject', v: 1, inject: { target: 'query', op: 'replace', match: 'name', name: 'StudentResults', source: 'inline', text: 'let\n    Source = 2\nin\n    Source', refreshOnLoad: false }, shiny: true };
    await page.locator('input[aria-label="Recipe file"]').setInputFiles({ name: 'students.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForSelector('[role=grid]');
    await page.getByRole('button', { name: 'Get', exact: true }).waitFor();
    await page.evaluate(() => { document.querySelector('.set-shell').scrollTop = 0; });
    await settle(page);
    await expect(page).toHaveScreenshot(`fable-shell-recipe-preview-${view.size}-${view.theme}.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
    await ctx.close();
  });
}
