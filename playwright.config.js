import { defineConfig } from '@playwright/test';

const ENGINE_SPECIFIC = ['**/*visual.spec.js', '**/fable-memory.spec.js', '**/fable-perf.spec.js'];

export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.js', 'a11y/**/*.spec.js'],
  timeout: 60000,
  snapshotPathTemplate: '{testDir}/__visual__/{arg}{ext}',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 }, acceptDownloads: true },
  webServer: { command: 'node tests/e2e/server.js', url: 'http://localhost:5173/index.html', reuseExistingServer: true, timeout: 20000 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: ENGINE_SPECIFIC },
    { name: 'webkit', use: { browserName: 'webkit' }, testIgnore: ENGINE_SPECIFIC }
  ]
});
