import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import base from '../playwright.config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromium = process.env.QUOIN_CHROMIUM || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

export default {
  ...base,
  testDir: resolve(root, 'tests'),
  snapshotPathTemplate: resolve(root, 'tests/__visual__/{arg}{ext}'),
  webServer: { command: `node ${resolve(root, 'tests/e2e/server.js')}`, cwd: root, url: 'http://localhost:5173/index.html', reuseExistingServer: true, timeout: 20000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: chromium, args: ['--no-sandbox'] } } }]
};
