import { expect } from '@playwright/test';
import { ext, fx, loadFile, item, editor, runButton, openSettings, openExport } from './helpers.js';

export async function pick(page, name) {
  const toggle = page.locator('.rail-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await item(page, name).click();
}

export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

export const STATES = [
  { id: '01-empty', mask: false, run: async () => {} },
  {
    id: '02-empty-drag',
    mask: false,
    run: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true })));
      await expect(page.locator('.dropzone.is-over')).toHaveCount(1);
    }
  },
  {
    id: '03-query-selected',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_vba_complex.xlsm'));
      await pick(page, 'FinalTable');
    }
  },
  {
    id: '04-query-running',
    mask: true,
    run: async (page) => {
      await loadFile(page, fx('long-run.xlsx'));
      await pick(page, 'Slow');
      await runButton(page).click();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    }
  },
  {
    id: '05-result-10000-rows',
    mask: true,
    run: async (page) => {
      await loadFile(page, fx('csv-query.xlsx'));
      await pick(page, 'StudentResults');
      await editor(page).fill('Table.FromColumns({List.Numbers(1, 10000), List.Transform(List.Numbers(1, 10000), each _ * 2.5)}, {"N", "Double"})');
      await runButton(page).click();
      await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('1');
    }
  },
  {
    id: '06-result-differs',
    mask: true,
    run: async (page) => {
      await loadFile(page, ext('pq_vba_complex.xlsm'));
      await pick(page, 'RawInput');
      const original = await editor(page).inputValue();
      await editor(page).fill(original.replace('in\n    #"Renamed Columns"', 'in\n    Table.FirstN(#"Renamed Columns", 0)'));
      await runButton(page).click();
      await expect(page.locator('#status')).toContainText('Row count differs');
    }
  },
  {
    id: '07-parse-error',
    mask: true,
    run: async (page) => {
      await loadFile(page, ext('pq_simple.xlsx'));
      await pick(page, 'StudentResults');
      await editor(page).fill('let\n    a = 1 +\nin\n    a');
      await runButton(page).click();
      await expect(page.locator('#alert')).not.toHaveText('');
    }
  },
  {
    id: '08-vba-module',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_vba_complex.xlsm'));
      await pick(page, 'Sheet1');
    }
  },
  {
    id: '09-settings-dialog',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_vba_complex.xlsm'));
      await openSettings(page);
      await expect(page.locator('dialog[open]')).toBeVisible();
    }
  },
  {
    id: '10-print-preview',
    mask: false,
    run: async (page) => {
      await loadFile(page, fx('csv-query.xlsx'));
      await pick(page, 'StudentResults');
      await editor(page).fill('Table.FromColumns({List.Numbers(1, 60), List.Transform(List.Numbers(1, 60), each _ * 2.5)}, {"N", "Double"})');
      await runButton(page).click();
      await expect(page.locator('.grid-cell:not(.grid-index)').first()).toHaveText('1');
      if (await page.locator('.print-button').isVisible()) await page.locator('.print-button').click();
      else {
        await openExport(page);
        await page.getByRole('menuitem', { name: 'Print preview' }).click();
      }
      await expect(page.locator('.print-page').first()).toBeVisible();
    }
  },

  {
    id: '11-nav-layer-search',
    mask: false,
    run: async (page) => {
      await loadFile(page, fx('many-queries.xlsx'));
      const toggle = page.locator('.rail-toggle');
      if (await toggle.isVisible()) await toggle.click();
      const group = page.getByRole('combobox', { name: 'Group by' });
      if (await group.isVisible()) await group.selectOption('layer');
      await page.getByRole('searchbox', { name: 'Search queries' }).fill('sales');
      await page.waitForTimeout(200);
    }
  },
  {
    id: '12-steps-peek',
    mask: true,
    run: async (page) => {
      await loadFile(page, fx('many-queries.xlsx'));
      const toggle = page.locator('.rail-toggle');
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('searchbox', { name: 'Search queries' }).fill('Sales_Broken');
      await page.locator('[role=treeitem][data-name="Sales_Broken"]').click();
      await editor(page).fill('let\n    Source = Sales_Raw,\n    Bad = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Bad');
      const toggle2 = page.locator('.rail-toggle');
      if (await toggle2.isVisible()) await toggle2.click();
      await page.getByRole('searchbox', { name: 'Search queries' }).fill('Wide_Steps');
      await page.locator('[role=treeitem][data-name="Wide_Steps"]').click();
      await runButton(page).click();
      const resultBtn = page.getByRole('button', { name: 'Result', exact: true });
      if (await resultBtn.isVisible()) await resultBtn.click();
      await page.waitForSelector('.grid-cell:not(.grid-index)');
      const stepsBtn = page.getByRole('button', { name: 'Steps', exact: true });
      if (await stepsBtn.isVisible()) await stepsBtn.click();
      await page.locator('.steps-list .step-row').nth(4).click();
      await page.waitForTimeout(650);
    }
  },
  {
    id: '13-view-chip-add-step',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_simple.xlsx'));
      await pick(page, 'StudentResults');
      await editor(page).fill([
        'let',
        '    Source = #table({"Name", "Age", "City"}, {{"Ann", 30, "Oslo"}, {"Bob", 25, "Rome"}, {"Cy", 30, "Oslo"}, {"Di", 41, "Paris"}, {"Ed", 25, "Rome"}, {"Flo", 30, "Oslo"}}),',
        '    Typed = Table.TransformColumnTypes(Source, {{"Age", Int64.Type}})',
        'in',
        '    Typed'
      ].join('\n'));
      await runButton(page).click();
      await page.waitForSelector('.grid-cell:not(.grid-index)');
      await page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: 'City' }).first().click();
      await page.getByRole('menuitem', { name: 'Filter\u2026' }).click();
      const dlg = page.getByRole('dialog', { name: 'Filter City' });
      await dlg.getByRole('radio', { name: 'Condition' }).check();
      await dlg.locator('select').selectOption({ label: 'equals' });
      await dlg.getByLabel('Value', { exact: true }).fill('Oslo');
      await dlg.getByRole('button', { name: 'Filter the view' }).click();
      await expect(page.locator('.chip.view')).toBeVisible();
      await page.locator('.dock-panel[data-panel=result] .grid-hcell', { hasText: 'City' }).first().click();
      await page.getByRole('menuitem', { name: 'Add as a step\u2026' }).click();
      await expect(page.getByRole('dialog', { name: 'Add a step for City' })).toBeVisible();
    }
  },
  {
    id: '14-graph-staging',
    mask: false,
    run: async (page) => {
      await loadFile(page, fx('many-queries.xlsx'));
      const toggle = page.locator('.rail-toggle');
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('searchbox', { name: 'Search queries' }).fill('Staging_01');
      await page.locator('[role=treeitem][data-name="Staging_01"]').click();
      await page.keyboard.press('Control+k');
      await page.keyboard.type('show the dependency graph');
      await page.locator('.palette-row').filter({ hasText: /^Show the dependency graph$/ }).click();
      await page.waitForSelector('.graph-svg');
      await page.waitForTimeout(300);
    }
  },
  {
    id: '15-problems-4',
    mask: false,
    run: async (page) => {
      await loadFile(page, fx('many-queries.xlsx'));
      await page.waitForTimeout(800);
      const result = page.getByRole('button', { name: 'Result', exact: true });
      if (await result.isVisible()) await result.click();
      await page.getByRole('tab', { name: /^Problems/ }).click();
      await expect(page.locator('.dock-panel[data-panel=problems] .problem-row')).toHaveCount(4);
    }
  },
  {
    id: '16-queue-run-all',
    mask: true,
    run: async (page) => {
      await loadFile(page, fx('many-queries.xlsx'));
      const toggle = page.locator('.rail-toggle');
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('searchbox', { name: 'Search queries' }).fill('Sales_Broken');
      await page.locator('[role=treeitem][data-name="Sales_Broken"]').click();
      await editor(page).fill('let\n    Source = Sales_Raw,\n    Bad = Table.SelectRows(Source, each [Amount] > 0)\nin\n    Bad');
      await expect.poll(() => page.locator('.status-problems').textContent()).toBe('Problems 3');
      await page.waitForTimeout(400);
      await page.keyboard.press('Control+Alt+Enter');
      await page.getByRole('dialog', { name: 'Some files are not bound yet' }).getByRole('button', { name: 'Run anyway' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Skip' }).click({ timeout: 30000 });
      const result = page.getByRole('button', { name: 'Result', exact: true });
      if (await result.isVisible()) await result.click();
      await page.getByRole('tab', { name: 'Queue' }).click();
      await page.waitForSelector('.dock-panel[data-panel=queue] .queue-table tbody tr', { timeout: 8000 });
      await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0, { timeout: 30000 });
      await page.waitForTimeout(300);
    }
  },
  {
    id: '17-vba-structure-error',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_vba_complex.xlsm'));
      await pick(page, 'Sheet1');
      await editor(page).fill('Public Sub Alpha()\r\n  Exit Function\r\nEnd Sub\r\nPublic Sub Alpha()\r\nEnd Sub');
      await page.waitForTimeout(400);
    }
  },
  {
    id: '18-palette-run',
    mask: false,
    run: async (page) => {
      await loadFile(page, ext('pq_simple.xlsx'));
      await pick(page, 'StudentResults');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('>run');
      await page.waitForTimeout(200);
    }
  }
];
