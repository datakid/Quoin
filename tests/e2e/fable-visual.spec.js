import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';
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
