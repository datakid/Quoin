import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openApp, dropTree, waitForSet, ext } from '../e2e/helpers.js';
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
