import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_ORDER, dockSplit } from '../../src/core/wb/layout-presets.js';

test('T-WB-10: the three presets exist in order and describe every pane', () => {
  assert.deepEqual(PRESET_ORDER, ['write', 'debug', 'review']);
  for (const name of PRESET_ORDER) {
    const p = PRESETS[name];
    assert.equal(typeof p.navigator, 'boolean');
    assert.equal(typeof p.inspector, 'boolean');
    assert.equal(typeof p.dock.open, 'boolean');
  }
});

test('T-WB-10: Write collapses the dock, Debug opens it at half on Result, Review opens it at 70 percent on Changes', () => {
  assert.deepEqual(PRESETS.write, { navigator: true, inspector: false, dock: { open: false } });
  assert.deepEqual(PRESETS.debug.dock, { open: true, tab: 'result', percent: 50 });
  assert.deepEqual(PRESETS.review.dock, { open: true, tab: 'changes', percent: 70 });
  assert.equal(PRESETS.debug.inspector, true);
});

test('T-WB-10: the dock share is kept within 15 and 85 percent and the editor gets the rest', () => {
  assert.deepEqual(dockSplit(50), { top: 50, bottom: 50 });
  assert.deepEqual(dockSplit(70), { top: 30, bottom: 70 });
  assert.deepEqual(dockSplit(5), { top: 85, bottom: 15 });
  assert.deepEqual(dockSplit(99), { top: 15, bottom: 85 });
});
