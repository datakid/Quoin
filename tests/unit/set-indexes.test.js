import test from 'node:test';
import assert from 'node:assert/strict';
import { inflatedEstimate, indexesOf } from '../../src/app/set-indexes.js';

test('the pool is charged the inflated size the index declares, never less than the file size', () => {
  assert.equal(inflatedEstimate({ size: 1000, index: { inflated: 250000 } }), 250000);
  assert.equal(inflatedEstimate({ size: 1000, index: { inflated: 400 } }), 1000);
});

test('the pool is charged the file size when there is no index or no declared size', () => {
  assert.equal(inflatedEstimate({ size: 1000 }), 1000);
  assert.equal(inflatedEstimate({ size: 1000, index: null }), 1000);
  assert.equal(inflatedEstimate({ size: 1000, index: {} }), 1000);
  assert.equal(inflatedEstimate({ size: 1000, index: { inflated: Number.NaN } }), 1000);
});

test('a file that was refused before it could be indexed gets a shell index with no inflated size', () => {
  const session = { list: () => [{ id: 'f1', name: 'a.xls', relPath: 'a.xls', size: 5, status: 'refused', skipReason: 'file.unsupportedExtension' }] };
  const [ix] = indexesOf(session);
  assert.equal(ix.inflated, 0);
  assert.equal(ix.refused.code, 'file.unsupportedExtension');
});
