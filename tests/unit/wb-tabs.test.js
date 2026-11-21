import test from 'node:test';
import assert from 'node:assert/strict';
import { TabModel, keyOf } from '../../src/core/wb/tabs-model.js';

const q = (name) => ({ type: 'query', name });
const m = (name) => ({ type: 'module', name });
const names = (model, g = 0) => model.groups[g].tabs.map((t) => t.key);

test('T-WB-12: opening an item makes it the active tab and opening it again does not duplicate it', () => {
  const t = new TabModel();
  assert.equal(t.open(q('A')).created, true);
  assert.equal(t.open(q('B')).created, true);
  assert.equal(t.open(q('A')).created, false);
  assert.deepEqual(names(t), ['query:A', 'query:B']);
  assert.equal(t.active, 'query:A');
  assert.equal(keyOf(m('M')), 'module:M');
});

test('T-WB-12: a preview tab is replaced by the next preview and kept by a permanent open', () => {
  const t = new TabModel();
  t.open(q('A'), { preview: true });
  const r = t.open(q('B'), { preview: true });
  assert.equal(r.replaced, 'query:A');
  assert.deepEqual(names(t), ['query:B']);
  t.open(q('B'));
  assert.equal(t.find('query:B').tab.preview, false);
  t.open(q('C'), { preview: true });
  t.open(q('D'), { preview: true });
  assert.deepEqual(names(t), ['query:B', 'query:D']);
  assert.equal(t.makePermanent('query:D'), true);
  assert.equal(t.makePermanent('query:D'), false);
  t.open(q('E'), { preview: true });
  assert.deepEqual(names(t), ['query:B', 'query:D', 'query:E']);
});

test('T-WB-12: a new permanent tab opens after the active one', () => {
  const t = new TabModel();
  t.open(q('A'));
  t.open(q('B'));
  t.open(q('C'));
  t.activate('query:A');
  t.open(q('D'));
  assert.deepEqual(names(t), ['query:A', 'query:D', 'query:B', 'query:C']);
});

test('T-WB-12: closing the active tab activates its neighbour and closing the last leaves nothing', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  t.activate('query:B');
  assert.equal(t.close('query:B').next, 'query:C');
  assert.equal(t.close('query:C').next, 'query:A');
  assert.equal(t.close('query:A').next, null);
  assert.equal(t.close('query:Z').closed, false);
  assert.equal(t.activeItem(), null);
});

test('T-WB-12: closing a tab that is not active keeps the active one', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  t.activate('query:A');
  assert.equal(t.close('query:C').next, 'query:A');
  assert.equal(t.active, 'query:A');
});

test('T-WB-12: split needs two tabs, moves the active tab to a second group, and join puts them back', () => {
  const t = new TabModel();
  t.open(q('A'));
  assert.equal(t.canSplit(), 'tabs.fewerThanTwo');
  assert.equal(t.split(), false);
  t.open(q('B'));
  t.open(q('C'));
  t.activate('query:B');
  assert.equal(t.canSplit(), true);
  assert.equal(t.split(), true);
  assert.equal(t.groups.length, 2);
  assert.deepEqual(names(t, 0), ['query:A', 'query:C']);
  assert.deepEqual(names(t, 1), ['query:B']);
  assert.equal(t.activeGroup, 1);
  assert.equal(t.groups[0].active, 'query:C');
  assert.equal(t.join(), true);
  assert.equal(t.lastRemoved, 1);
  assert.equal(t.groups.length, 1);
  assert.deepEqual(names(t, 0), ['query:A', 'query:C', 'query:B']);
  assert.equal(t.active, 'query:B');
  assert.equal(t.toggleSplit(), true);
  assert.equal(t.groups.length, 2);
  assert.equal(t.toggleSplit(), true);
  assert.equal(t.groups.length, 1);
});

test('T-WB-12: an item lives in one group, opening it from the other group activates that group', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  t.activate('query:B');
  t.split();
  t.focusGroup(0);
  const r = t.open(q('B'));
  assert.equal(r.created, false);
  assert.equal(r.group, 1);
  assert.equal(t.activeGroup, 1);
  assert.equal(t.groupOf('query:B'), 1);
  assert.equal(t.groupOf('query:A'), 0);
  assert.equal(t.groupOf('query:Z'), -1);
});

test('T-WB-12: new tabs open in the active group', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  t.split();
  t.open(q('D'));
  assert.equal(t.groupOf('query:D'), 1);
  t.focusGroup(0);
  t.open(q('E'));
  assert.equal(t.groupOf('query:E'), 0);
});

test('T-WB-12: moving a tab to the other group, and closing the last tab of a group removes the group', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  assert.equal(t.move('query:C', 1), true);
  assert.equal(t.groups.length, 2);
  assert.deepEqual(names(t, 1), ['query:C']);
  assert.equal(t.move('query:A', 1), true);
  assert.deepEqual(names(t, 1), ['query:C', 'query:A']);
  assert.equal(t.move('query:A', 1), false);
  assert.equal(t.move('query:Z', 0), false);
  assert.equal(t.move('query:B', 1), true);
  assert.equal(t.groups.length, 1);
  assert.deepEqual(names(t, 0), ['query:C', 'query:A', 'query:B']);
  const u = new TabModel();
  u.open(q('A'));
  assert.equal(u.move('query:A', 1), false);
  u.open(q('B'));
  u.split();
  const r = u.close('query:B');
  assert.equal(r.groupRemoved, true);
  assert.equal(u.lastRemoved, 1);
  assert.equal(u.groups.length, 1);
  assert.equal(u.activeGroup, 0);
  assert.equal(u.active, 'query:A');
});

test('T-WB-12: cycling wraps inside the active group and goTo picks the nth tab', () => {
  const t = new TabModel();
  for (const n of ['A', 'B', 'C']) t.open(q(n));
  t.activate('query:A');
  assert.equal(t.cycle(-1), 'query:C');
  assert.equal(t.cycle(1), 'query:A');
  assert.equal(t.cycle(1), 'query:B');
  assert.equal(t.goTo(3), 'query:C');
  assert.equal(t.goTo(9), null);
  assert.equal(t.active, 'query:C');
  t.split();
  assert.deepEqual(names(t, 1), ['query:C']);
  assert.equal(t.cycle(1), 'query:C');
});

test('T-WB-12: scroll and caret are remembered per tab and dropped when the tab closes or is replaced', () => {
  const t = new TabModel();
  t.open(q('A'));
  t.open(q('B'));
  t.remember('query:A', { scrollTop: 120, scrollLeft: 4, start: 10, end: 12 });
  assert.deepEqual(t.recall('query:A'), { scrollTop: 120, scrollLeft: 4, start: 10, end: 12 });
  assert.equal(t.recall('query:B'), null);
  t.move('query:A', 1);
  assert.equal(t.recall('query:A').scrollTop, 120);
  t.close('query:A');
  assert.equal(t.recall('query:A'), null);
  t.open(q('P'), { preview: true });
  t.remember('query:P', { scrollTop: 5, scrollLeft: 0, start: 0, end: 0 });
  t.open(q('Q'), { preview: true });
  assert.equal(t.recall('query:P'), null);
});

test('T-WB-12: closing the last tab of the first group leaves the second group as the only group', () => {
  const t = new TabModel();
  for (const n of ['A', 'B']) t.open(q(n));
  t.split();
  t.focusGroup(0);
  const r = t.close('query:A');
  assert.equal(r.groupRemoved, true);
  assert.equal(t.lastRemoved, 0);
  assert.deepEqual(names(t, 0), ['query:B']);
  assert.equal(t.active, 'query:B');
});
