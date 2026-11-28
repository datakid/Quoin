import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fx, openApp, loadFile, item, runButton, dropTree, waitForSet } from './helpers.js';

const b64 = (path) => readFileSync(path).toString('base64');
const matrix = (page) => page.getByRole('grid', { name: 'Run results' });
const report = (name, info) => { throw new Error(`PROBE ${name} ${JSON.stringify(info)}`); };

const fakeRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    run_id: 'r1', file: `book${String(i).padStart(4, '0')}.xlsx`, folder: 'east/', unit: 'book', unit_index: 1, recipe: 'collect', action: 'collect', compute: '',
    verdict: ['unchanged', 'changed', 'skipped', 'failed', 'refused', 'cancelled', 'not-released'][i % 7],
    reason_code: i % 7 >= 2 ? 'file.encrypted' : '', reason: i % 7 >= 2 ? 'This workbook is encrypted.' : '',
    old_hash: 'a'.repeat(64), new_hash: 'b'.repeat(64), output: '', verified: true, signature_removed: false, duration_ms: 1
  }));

async function show(page, n) {
  await openApp(page);
  await page.evaluate((rows) => {
    window.__quoin.set.addFiles([{ name: 'a.xlsx', relPath: 'a.xlsx', size: 1, lastModified: 1, file: new Blob([new Uint8Array(1)]) }]);
    window.__quoin.shell.showResult(rows, 'report');
  }, fakeRows(n));
}

const chainOf = () => {
  const g = document.querySelector('.grid');
  const out = [];
  for (let e = g; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    out.push([e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''), Math.round(e.clientHeight), Math.round(e.scrollHeight), cs.display, cs.flexDirection, cs.overflowY, cs.height, cs.minHeight, cs.gridTemplateRows.slice(0, 60)].join('|'));
  }
  return out;
};

for (const tag of ['a', 'b', 'c']) {
  test(`probe 6${tag}: painted rows over time`, async ({ page }) => {
    await show(page, 5000);
    const sample = () => page.evaluate(() => ({ painted: document.querySelectorAll('.grid .grid-row').length, client: document.querySelector('.grid').clientHeight, scroll: document.querySelector('.grid').scrollHeight, vh: innerHeight }));
    const first = await sample();
    await page.waitForTimeout(150);
    const later = await sample();
    await page.waitForTimeout(800);
    const last = await sample();
    const chain = await page.evaluate(chainOf);
    report(`6${tag}`, { first, later, last, chain: tag === 'a' ? chain : undefined });
  });
}

test('probe 1: phone layout and scroll containers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await dropTree(page, [{ name: 'books', children: [['signed.xlsm', fx('signed.xlsm')], ['mixed.xlsm', fx('mixed.xlsm')]].map(([name, path]) => ({ name, data: b64(path) })) }]);
  await waitForSet(page);
  const moduleReplace = { recipe: 'inject', v: 1, inject: { target: 'module', op: 'replace', match: 'name', name: 'Module1', source: 'inline', text: 'Sub A()\r\nEnd Sub\r\n', refreshOnLoad: false } };
  await page.locator('input[aria-label="Recipe file"]').setInputFiles({ name: 'my.quoin-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(moduleReplace)) });
  const snap = () => page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
    const scrollers = [];
    for (let e = document.querySelector('.set-result') || document.querySelector('.set-shell'); e; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 1) scrollers.push([e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/)[0], Math.round(e.scrollTop), e.scrollHeight, e.clientHeight, getComputedStyle(e).overflowY]);
    }
    return { shell: box('.set-shell'), files: box('.set-files'), recipe: box('.set-recipe'), result: box('.set-result'), detail: box('.set-detail'), scrollers, winY: Math.round(scrollY), docTop: Math.round(document.scrollingElement.scrollTop), inner: [innerWidth, innerHeight] };
  });
  const before = await snap();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await matrix(page).waitFor();
  const afterPreview = await snap();
  await page.waitForTimeout(700);
  const afterWait = await snap();
  const row = matrix(page).locator('.grid-row').filter({ hasText: 'Yes' }).first();
  await row.locator('.grid-cell:not(.grid-index)').first().click();
  await page.locator('.set-detail').getByRole('region').waitFor();
  const afterPick = await snap();
  report('1', { before, afterPreview, afterWait, afterPick });
});

test('probe 2: Tab leaves the table', async ({ page }) => {
  await show(page, 20);
  await matrix(page).focus();
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => { window.__tab = []; document.addEventListener('keydown', (e) => { if (e.key === 'Tab') window.__tab.push(e.defaultPrevented ? 'prevented' : 'free'); }, true); });
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const g = document.querySelector('.grid');
    const later = [...document.querySelectorAll(sel)].filter((e) => g.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && !g.contains(e) && e.offsetParent !== null).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/)[0]);
    return { active: a ? a.tagName.toLowerCase() + '.' + String(a.className).trim().split(/\s+/)[0] : null, isGrid: a === g, tab: window.__tab, laterFocusable: later.slice(0, 6), count: later.length };
  });
  report('2', info);
});

test('probe 3: drag selection event log', async ({ page }) => {
  await show(page, 20);
  await page.evaluate(() => {
    window.__log = [];
    for (const t of ['pointerdown', 'pointerover', 'pointerenter', 'pointermove', 'pointerup', 'mousedown', 'mouseover', 'mouseup', 'dragstart', 'selectstart', 'pointercancel']) {
      document.addEventListener(t, (e) => { if (window.__log.length < 60) window.__log.push(`${t}@${e.target.id || e.target.className || e.target.tagName}:b${e.buttons}`); }, true);
    }
  });
  const cell = (r, c) => matrix(page).locator(`#gc-${r}-${c}`);
  const from = await cell(0, 0).boundingBox();
  await page.mouse.move(from.x + 5, from.y + 5);
  await page.mouse.down();
  const afterDown = await page.evaluate(() => [document.querySelectorAll('.grid-cell.sel').length, window.__quoin.shell.matrix.grid.drag]);
  const to = await cell(3, 1).boundingBox();
  await page.mouse.move(to.x + 5, to.y + 5, { steps: 5 });
  const afterMove = await page.evaluate(() => [document.querySelectorAll('.grid-cell.sel').length, window.__quoin.shell.matrix.grid.drag]);
  await page.mouse.up();
  const log = await page.evaluate(() => window.__log);
  report('3', { afterDown, afterMove, from: [Math.round(from.x), Math.round(from.y)], to: [Math.round(to.x), Math.round(to.y)], log });
});

test('probe 4: copy event', async ({ page }) => {
  await show(page, 3);
  const cells = page.locator('.grid-cell[role=gridcell]');
  await cells.nth(0).dispatchEvent('pointerdown');
  await cells.nth(3).dispatchEvent('pointerdown', { shiftKey: true });
  const synthetic = await page.evaluate(() => {
    const errors = [];
    window.addEventListener('error', (e) => errors.push(String(e.message)));
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, cancelable: true, bubbles: true });
    const same = ev.clipboardData === dt;
    const hasData = ev.clipboardData ? 'object' : String(ev.clipboardData);
    document.querySelector('.grid').dispatchEvent(ev);
    return { sel: document.querySelectorAll('.grid-cell.sel').length, same, hasData, text: dt.getData('text/plain'), prevented: ev.defaultPrevented, errors };
  });
  await page.evaluate(() => { window.__real = []; document.addEventListener('copy', (e) => { window.__real.push(e.clipboardData ? e.clipboardData.getData('text/plain') : 'no clipboardData'); }); });
  await page.locator('.grid').focus();
  await page.keyboard.press('Control+C');
  const real = await page.evaluate(() => window.__real);
  report('4', { synthetic, real });
});

test('probe 5: a million rows', async ({ page }) => {
  test.setTimeout(150000);
  await openApp(page);
  await loadFile(page, fx('big-grid.xlsx'));
  await item(page, 'Big').click();
  await runButton(page).click();
  await page.locator('.grid-cell:not(.grid-index)').first().waitFor({ timeout: 90000 });
  const info = await page.evaluate(async () => {
    const g = document.querySelector('.grid');
    const sizer = g.querySelector('.grid-sizer');
    const r = { rows: g.getAttribute('aria-rowcount'), client: g.clientHeight, scroll: g.scrollHeight, sizerStyle: sizer.style.height, sizerComputed: getComputedStyle(sizer).height };
    g.scrollTop = 1e10;
    r.afterHuge = g.scrollTop;
    g.scrollTop = 50000;
    r.after50k = g.scrollTop;
    g.scrollTop = 20000000;
    r.after20m = g.scrollTop;
    g.scrollTop = 0;
    for (let i = 0; i < 5; i++) { g.scrollTop += 3000; await new Promise((res) => requestAnimationFrame(res)); }
    r.steps = g.scrollTop;
    return r;
  });
  report('5', info);
});
