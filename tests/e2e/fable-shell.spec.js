import { test, expect } from '@playwright/test';
import { fx, ext, openApp, dropFile } from './helpers.js';
import { SET_STATES, setUpSetState } from './states.js';

const runText = (page) => page.locator('.set-run-text');

test('fable shell: the empty start screen is unchanged and the shell appears with the first dropped set', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.empty .message, .dropzone')).not.toHaveCount(0);
  await expect(page.locator('.set-shell')).toHaveCount(0);
  await setUpSetState(page, 'ready');
  await expect(page.locator('.set-shell')).toHaveCount(1);
  await expect(page.locator('.dropzone')).toHaveCount(0);
});

test('fable shell: three named regions, a summary in the top bar and a title that says Fable', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'ready');
  for (const name of ['Files', 'Recipe', 'Result']) await expect(page.getByRole('region', { name })).toHaveCount(1);
  await expect(page.locator('.file-meta')).toHaveText('4 files · 3 queries');
  await expect(page).toHaveTitle('4 files — quoin Fable');
  const boxes = await page.evaluate(() => ['.set-files', '.set-recipe', '.set-result'].map((s) => document.querySelector(s).getBoundingClientRect().left));
  expect(boxes[0]).toBeLessThan(boxes[1]);
  expect(boxes[1]).toBeLessThan(boxes[2]);
});

test('fable shell: the files list shows names, folders and one badge per file with the reason for a skipped file', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'ready');
  const rows = page.locator('.set-file');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('book1.xlsx');
  await expect(rows.nth(0)).toContainText('east/');
  expect(await rows.evaluateAll((els) => els.map((e) => e.dataset.badge))).toEqual(['ready', 'ready', 'skipped', 'failed']);
  expect(await rows.evaluateAll((els) => els.map((e) => e.querySelector('.set-badge').textContent))).toEqual(['Ready', 'Ready', 'Skipped', 'Failed']);
  await expect(rows.nth(2)).toContainText('This workbook is encrypted. Remove the password in Excel first.');
  await expect(rows.nth(3)).toContainText('This file could not be read.');
});

test('fable shell: the filter narrows the list and says when nothing matches', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'ready');
  await expect(page.locator('.set-count')).toHaveText('4');
  await page.getByRole('searchbox', { name: 'Filter files' }).fill('book3');
  await expect(page.locator('.set-file')).toHaveCount(1);
  await expect(page.locator('.set-count')).toHaveText('1 of 4');
  await page.getByRole('searchbox', { name: 'Filter files' }).fill('zzz');
  await expect(page.locator('.set-file')).toHaveCount(0);
  await expect(page.locator('.set-empty')).toHaveText('No file matches.');
  await page.getByRole('searchbox', { name: 'Filter files' }).fill('');
  await expect(page.locator('.set-file')).toHaveCount(4);
});

test('fable shell: the empty set reads only the drop prompt', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'empty');
  await expect(page.locator('.set-empty')).toHaveText('Drop workbooks or a folder.');
  await expect(page.locator('.set-file')).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Filter files' })).toBeHidden();
  await expect(runText(page)).toHaveText('');
  await expect(page.locator('.set-bar')).toBeHidden();
});

const RUN_TEXT = {
  indexing: 'Indexing 1 of 4',
  ready: '2 ready · 1 skipped · 1 failed',
  previewing: 'Previewing',
  running: 'Running 1 of 4',
  done: 'Done',
  doneWithFailures: 'Done · 2 failed'
};

for (const [state, text] of Object.entries(RUN_TEXT)) {
  test(`fable shell: the run bar in ${state} says "${text}"`, async ({ page }) => {
    await openApp(page);
    await setUpSetState(page, state);
    await expect(runText(page)).toHaveText(text);
    const barShown = state === 'indexing' || state === 'running';
    if (barShown) {
      await expect(page.locator('.set-bar')).toBeVisible();
      expect(await page.locator('.set-bar').evaluate((b) => [b.value, b.max])).toEqual([1, 4]);
    } else await expect(page.locator('.set-bar')).toBeHidden();
  });
}

test('fable shell: every state is reachable and the shell animates only colour, opacity and transform', async ({ page }) => {
  expect(SET_STATES).toHaveLength(7);
  await openApp(page);
  await setUpSetState(page, 'running');
  const offenders = await page.evaluate(() => {
    const allowed = new Set(['color', 'background-color', 'border-color', 'opacity', 'transform', 'box-shadow', 'outline-color', 'all']);
    return [...document.querySelectorAll('.set-shell, .set-shell *')].filter((el) => {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.animationDuration) > 0) return true;
      if (!(parseFloat(cs.transitionDuration) > 0)) return false;
      return cs.transitionProperty.split(',').map((p) => p.trim()).some((p) => !allowed.has(p));
    }).map((el) => el.className);
  });
  expect(offenders).toEqual([]);
});

test('fable shell: Tab reaches the filter, the recipe region and the result region in order', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'ready');
  await page.getByRole('searchbox', { name: 'Filter files' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Recipe' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Result' })).toBeFocused();
  const outline = await page.getByRole('region', { name: 'Result' }).evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
  expect(outline).toBeGreaterThan(0);
});

test('fable shell: at a narrow width the regions stack and the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await setUpSetState(page, 'ready');
  const tops = await page.evaluate(() => ['.set-files', '.set-recipe', '.set-result'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('fable shell: dropping one workbook while the shell shows opens it and removes the shell', async ({ page }) => {
  await openApp(page);
  await setUpSetState(page, 'ready');
  await dropFile(page, ext('pq_simple.xlsx'), 'pq_simple.xlsx');
  await expect(page.locator('.workspace')).toHaveCount(1);
  await expect(page.locator('.set-shell')).toHaveCount(0);
});

test('fable shell: a real two-file drop shows both files, indexed, with a summary', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const make = async (url, name) => new File([await (await fetch(url)).arrayBuffer()], name);
    const dt = new DataTransfer();
    dt.items.add(await make('/tests/fixtures/workbooks/mixed.xlsm', 'mixed.xlsm'));
    dt.items.add(await make('/tests/fixtures/external/pq_simple.xlsx', 'pq_simple.xlsx'));
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    window.dispatchEvent(ev);
  });
  await expect(runText(page)).toHaveText('2 ready', { timeout: 30000 });
  await expect(page.locator('.set-file')).toHaveCount(2);
  await expect(page.locator('.file-meta')).toContainText('2 files · ');
  expect(fx('mixed.xlsm')).toBeTruthy();
});
