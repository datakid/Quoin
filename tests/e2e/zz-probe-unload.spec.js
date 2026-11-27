import { test, expect } from '@playwright/test';
import { openApp, loadFile, ext, editor } from './helpers.js';

async function dirty(page) {
  await openApp(page);
  await loadFile(page, ext('pq_simple.xlsx'));
  await page.locator('[role=treeitem][data-type=query]').first().click();
  const original = await editor(page).inputValue();
  await editor(page).click();
  await editor(page).fill(`${original}\n// edit`);
  await page.keyboard.press('End');
}

const watch = (page) => {
  const seen = [];
  page.on('dialog', async (d) => {
    seen.push(d.type());
    await d.accept();
  });
  return seen;
};

test('probe a: key press then page.reload', async ({ page }) => {
  await dirty(page);
  const seen = watch(page);
  await page.reload();
  expect(seen).toContain('beforeunload');
});

test('probe b: location.reload from inside the page', async ({ page }) => {
  await dirty(page);
  const seen = watch(page);
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  await page.waitForTimeout(3000);
  expect(seen).toContain('beforeunload');
});

test('probe c: page.close with runBeforeUnload', async ({ page }) => {
  await dirty(page);
  const seen = watch(page);
  await page.close({ runBeforeUnload: true });
  expect(seen).toContain('beforeunload');
});

test('probe d: page.goto a different address', async ({ page }) => {
  await dirty(page);
  const seen = watch(page);
  await page.goto('/index.html?probe=1');
  expect(seen).toContain('beforeunload');
});

test('probe e: the page has user activation', async ({ page }) => {
  await dirty(page);
  expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
});

test('probe f: the leave guard is installed once the session is dirty', async ({ page }) => {
  await dirty(page);
  const prevented = await page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
