import test from 'node:test';
import assert from 'node:assert/strict';
import { oneExecuteEntryFindings } from '../lint/checks.js';

const msgs = (relPath, source) => oneExecuteEntryFindings(relPath, source).map((f) => f.msg);

test('T-LINT-21 flags an import of applyChangeSet outside the execute entry', () => {
  assert.deepEqual(msgs('src/app/a.js', "import { applyChangeSet } from '../core/save.js';"), ['applyChangeSet']);
  assert.deepEqual(msgs('src/batch/execute/collect.js', "import { buildWorkbook, applyChangeSet } from '../../core/save.js';"), ['applyChangeSet']);
  assert.deepEqual(msgs('src/workers/m-worker.js', "import { applyChangeSet } from '../core/save.js';"), ['applyChangeSet']);
});

test('T-LINT-21 flags a renamed import, a re-export, a namespace import and a dynamic import of save.js', () => {
  assert.deepEqual(msgs('src/app/a.js', "import { applyChangeSet as run } from '../core/save.js';"), ['applyChangeSet']);
  assert.deepEqual(msgs('src/batch/a.js', "export { applyChangeSet } from '../core/save.js';"), ['applyChangeSet']);
  assert.deepEqual(msgs('src/app/a.js', "import * as save from '../core/save.js';"), ['namespace import of src/core/save.js']);
  assert.deepEqual(msgs('src/app/a.js', "export * from '../core/save.js';"), ['namespace import of src/core/save.js']);
  assert.deepEqual(msgs('src/app/a.js', "export const load = () => import('../core/save.js');"), ['dynamic import of src/core/save.js']);
});

test('T-LINT-21 allows the execute entry and save.js itself', () => {
  assert.deepEqual(oneExecuteEntryFindings('src/batch/execute/index.js', "import { applyChangeSet } from '../../core/save.js';"), []);
  assert.deepEqual(oneExecuteEntryFindings('src/core/save.js', 'export async function applyChangeSet() {}'), []);
});

test('T-LINT-21 allows other names from save.js and ignores unrelated files and strings', () => {
  assert.deepEqual(oneExecuteEntryFindings('src/app/session.js', "import { buildWorkbook, suggestedFileName } from '../core/save.js';"), []);
  assert.deepEqual(oneExecuteEntryFindings('src/app/a.js', "import { applyChangeSet } from './other.js';"), []);
  assert.deepEqual(oneExecuteEntryFindings('src/app/a.js', "export const a = { applyChangeSet: 1, b: 'applyChangeSet' };"), []);
  assert.deepEqual(oneExecuteEntryFindings('tests/unit/a.test.js', "import { applyChangeSet } from '../../src/core/save.js';"), []);
  assert.deepEqual(oneExecuteEntryFindings('scripts/a.mjs', "import { applyChangeSet } from '../src/core/save.js';"), []);
});
