import test from 'node:test';
import assert from 'node:assert/strict';
import { S } from '../../src/ui/strings.js';

const counts = (over) => ({ changed: 0, unchanged: 0, skipped: 0, refused: 0, failed: 0, 'not-released': 0, ...over });

test('a run that changed something adds no closing sentence', () => {
  assert.equal(S.runClosing(counts({ changed: 3, skipped: 2 })), '');
});

test('a run where every row was skipped says none failed', () => {
  const text = S.runClosing(counts({ skipped: 13 }));
  assert.match(text, /No workbook was changed/);
  assert.match(text, /none failed/);
});

test('a run with a refused or failed row does not claim that none failed', () => {
  for (const over of [{ skipped: 2, refused: 1 }, { skipped: 2, failed: 1 }, { 'not-released': 1 }]) {
    const text = S.runClosing(counts(over));
    assert.match(text, /No workbook was changed/);
    assert.doesNotMatch(text, /none failed/);
  }
});

test('a run with only unchanged rows says no workbook was changed', () => {
  assert.equal(S.runClosing(counts({ unchanged: 4 })), 'No workbook was changed.');
});
