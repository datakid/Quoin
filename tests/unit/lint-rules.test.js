import test from 'node:test';
import assert from 'node:assert/strict';
import { commentFindings, layerPurityFindings, importDirectionFindings, base64Findings } from '../lint/checks.js';

const lines = (relPath, source) => commentFindings(relPath, source).map((f) => f.line);

test('T-LINT-1 flags a line comment and a block comment in .js and .mjs', () => {
  assert.deepEqual(lines('src/a.js', 'const a = 1;\n// x\n'), [2]);
  assert.deepEqual(lines('scripts/a.mjs', '/* x */\nconst a = 1;\n'), [1]);
  assert.deepEqual(lines('src/a.js', '/** doc */\nexport const a = 1;\n'), [1]);
});

test('T-LINT-1 ignores comment markers inside strings, templates and regular expressions', () => {
  assert.deepEqual(lines('src/a.js', "const a = '// x';\nconst b = `/* y */`;\nconst c = /\\/\\//;\nconst d = 'http://x';\n"), []);
});

test('T-LINT-1 accepts a hashbang line', () => {
  assert.deepEqual(lines('scripts/a.mjs', '#!/usr/bin/env node\nconst a = 1;\n'), []);
});

test('T-LINT-1 flags a block comment in .css', () => {
  assert.deepEqual(lines('styles/a.css', 'a {\n  color: red;\n}\n/* x */\n'), [4]);
  assert.deepEqual(lines('styles/a.css', 'a { color: red; }\n'), []);
});

test('T-LINT-1 flags an HTML comment in .html and .svg', () => {
  assert.equal(commentFindings('index.html', '<p>a</p><!-- x -->').length, 1);
  assert.equal(commentFindings('public/a.svg', '<svg><!-- x --></svg>').length, 1);
  assert.deepEqual(commentFindings('index.html', '<p>a</p>'), []);
});

test('T-LINT-1 flags a comment in .yml and .yaml', () => {
  assert.deepEqual(lines('.github/workflows/ci.yml', 'name: ci\n# x\non: push\n'), [2]);
  assert.deepEqual(lines('config/a.yaml', 'name: ci # x\n'), [1]);
  assert.deepEqual(lines('.github/workflows/ci.yml', '  # x\n'), [1]);
});

test('T-LINT-1 ignores a hash inside a yaml string or a url fragment', () => {
  assert.deepEqual(lines('.github/workflows/ci.yml', 'run: echo "a # b"\nurl: https://x/y#z\nrun2: \'a # b\'\n'), []);
});

test('T-LINT-1 flags a comment line in _headers and ignores its path globs', () => {
  assert.deepEqual(lines('_headers', '# x\n/*\n  Referrer-Policy: no-referrer\n'), [1]);
  assert.deepEqual(lines('_headers', '/*\n  Referrer-Policy: no-referrer\n/sw.js\n  Cache-Control: no-cache\n'), []);
});

test('T-LINT-1 has no opinion on file types that are not code', () => {
  assert.deepEqual(commentFindings('README.md', '<!-- x -->\n# title\n'), []);
  assert.deepEqual(commentFindings('package.json', '{}'), []);
});

const msgs = (fn, relPath, source) => fn(relPath, source).map((f) => f.msg);

test('T-LINT-18 flags browser and worker globals in src/batch', () => {
  assert.deepEqual(msgs(layerPurityFindings, 'src/batch/a.js', 'export const a = document.title;'), ['document']);
  assert.deepEqual(msgs(layerPurityFindings, 'src/batch/a.js', 'export const a = [window, navigator, localStorage, self];'), ['window', 'navigator', 'localStorage', 'self']);
  assert.deepEqual(msgs(layerPurityFindings, 'src/batch/a.js', 'postMessage(1); new Worker(x);'), ['postMessage', 'Worker']);
});

test('T-LINT-18 ignores property names, object keys, strings and other folders', () => {
  assert.deepEqual(layerPurityFindings('src/batch/a.js', "export const a = { document: 1, b: x.window, c: 'self' };"), []);
  assert.deepEqual(layerPurityFindings('src/app/a.js', 'export const a = document.title;'), []);
  assert.deepEqual(layerPurityFindings('src/batch/a.js', 'export const a = 1;'), []);
});

test('T-LINT-19 core imports only core', () => {
  assert.deepEqual(msgs(importDirectionFindings, 'src/core/a.js', "import { x } from '../batch/b.js';"), ['src/core -> src/batch']);
  assert.deepEqual(msgs(importDirectionFindings, 'src/core/pq/a.js', "import { x } from '../../app/b.js';"), ['src/core -> src/app']);
  assert.deepEqual(importDirectionFindings('src/core/pq/a.js', "import { x } from '../b.js'; export * from './c.js';"), []);
});

test('T-LINT-19 batch imports core and batch, and resolve never imports execute or verify', () => {
  assert.deepEqual(importDirectionFindings('src/batch/index/a.js', "import { x } from '../../core/b.js'; import { y } from '../recipe/c.js';"), []);
  assert.deepEqual(msgs(importDirectionFindings, 'src/batch/index/a.js', "import { x } from '../../ui/b.js';"), ['src/batch -> src/ui']);
  assert.deepEqual(msgs(importDirectionFindings, 'src/batch/resolve/a.js', "import { x } from '../execute/b.js';"), ['src/batch/resolve -> src/batch/execute']);
  assert.deepEqual(msgs(importDirectionFindings, 'src/batch/resolve/a.js', "import { x } from '../verify/b.js';"), ['src/batch/resolve -> src/batch/verify']);
  assert.deepEqual(importDirectionFindings('src/batch/execute/a.js', "import { x } from '../resolve/b.js';"), []);
});

test('T-LINT-19 workers import core and batch only', () => {
  assert.deepEqual(importDirectionFindings('src/workers/a.js', "import { x } from '../core/b.js'; import { y } from '../batch/c.js';"), []);
  assert.deepEqual(msgs(importDirectionFindings, 'src/workers/a.js', "import { x } from '../app/b.js';"), ['src/workers -> src/app']);
  assert.deepEqual(msgs(importDirectionFindings, 'src/workers/a.js', "import { x } from '../ui/b.js';"), ['src/workers -> src/ui']);
});

test('T-LINT-19 ui imports ui and core only, with one named exception', () => {
  assert.deepEqual(importDirectionFindings('src/ui/a.js', "import { x } from './b.js'; import { y } from '../core/c.js';"), []);
  assert.deepEqual(msgs(importDirectionFindings, 'src/ui/a.js', "import { x } from '../app/b.js';"), ['src/ui -> src/app']);
  assert.deepEqual(msgs(importDirectionFindings, 'src/ui/a.js', "import { x } from '../batch/execute/b.js';"), ['src/ui -> src/batch']);
  assert.deepEqual(importDirectionFindings('src/ui/wb/steps-panel.js', "import { matches } from '../../app/commands.js';"), []);
  assert.deepEqual(msgs(importDirectionFindings, 'src/ui/wb/other.js', "import { matches } from '../../app/commands.js';"), ['src/ui -> src/app']);
});

test('T-LINT-19 app may import any layer and dynamic imports are checked too', () => {
  assert.deepEqual(importDirectionFindings('src/app/a.js', "import { x } from '../batch/b.js'; import { y } from '../workers/c.js';"), []);
  assert.deepEqual(msgs(importDirectionFindings, 'src/core/a.js', "export const f = () => import('../app/b.js');"), ['src/core -> src/app']);
});

test('T-LINT-20 allows base64 helpers only inside src/core', () => {
  assert.deepEqual(base64Findings('src/core/pq/a.js', "export const a = btoa('x') + atob('y');"), []);
  assert.deepEqual(msgs(base64Findings, 'src/batch/a.js', "export const a = btoa('x');"), ['btoa']);
  assert.deepEqual(msgs(base64Findings, 'src/app/a.js', "export const a = window.atob('x');"), ['atob']);
  assert.deepEqual(msgs(base64Findings, 'src/ui/a.js', 'export const a = base64Encode(x) + base64Decode(y);'), ['base64Encode', 'base64Decode']);
  assert.deepEqual(msgs(base64Findings, 'sw.js', "self.btoa('x');"), ['btoa']);
  assert.deepEqual(base64Findings('src/app/a.js', "export const a = { btoa: 1 }; export const b = 'atob';"), []);
});
