import test from 'node:test';
import assert from 'node:assert/strict';
import { commentFindings } from '../lint/checks.js';

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
