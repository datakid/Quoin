import test from 'node:test';
import assert from 'node:assert/strict';
import { matchProcedures, revertProcedure } from '../../src/core/vba/proc-diff.js';

const ORIG = ['Option Explicit', '', 'Public Sub A()', '  x = 1', 'End Sub', '', 'Public Sub B()', '  y = 2', 'End Sub', '', 'Function C() As Long', '  C = 3', 'End Function'].join('\r\n');

const status = (r) => Object.fromEntries(r.rows.map((x) => [x.name, x.status]));

test('T-WB-22: an untouched module has every procedure marked same', () => {
  assert.deepEqual(status(matchProcedures(ORIG, ORIG)), { A: 'same', B: 'same', C: 'same' });
});

test('T-WB-22: edited, added and removed procedures are told apart by kind and name', () => {
  const cur = ORIG.replace('x = 1', 'x = 10').replace('Function C() As Long\r\n  C = 3\r\nEnd Function', 'Sub D()\r\nEnd Sub');
  const r = matchProcedures(ORIG, cur);
  assert.deepEqual(status(r), { A: 'edited', B: 'same', D: 'added' });
  assert.deepEqual(r.removed.map((x) => [x.name, x.kind, x.status]), [['C', 'function', 'removed']]);
});

test('T-WB-22: trailing whitespace and line endings alone are not an edit', () => {
  const cur = ORIG.replace(/\r\n/g, '\n').replace('x = 1', 'x = 1   ');
  assert.deepEqual(status(matchProcedures(ORIG, cur)), { A: 'same', B: 'same', C: 'same' });
});

test('T-WB-22: a Property Get and Let with one name are tracked separately', () => {
  const o = 'Property Get P()\nEnd Property\nProperty Let P(v)\nEnd Property';
  const cur = 'Property Get P()\n  x = 1\nEnd Property\nProperty Let P(v)\nEnd Property';
  assert.deepEqual(matchProcedures(o, cur).rows.map((x) => [x.kind, x.status]), [['property-get', 'edited'], ['property-let', 'same']]);
});

test('T-WB-22: reverting one of two edited procedures leaves the other edited', () => {
  const cur = ORIG.replace('x = 1', 'x = 10').replace('y = 2', 'y = 20');
  const res = revertProcedure(ORIG, cur, 'sub:a');
  assert.equal(res.ok, true);
  assert.equal(res.text, ORIG.replace('y = 2', 'y = 20'));
  assert.deepEqual(status(matchProcedures(ORIG, res.text)), { A: 'same', B: 'edited', C: 'same' });
});

test('T-WB-22: reverting keeps the line ending of the current text and works when the procedure grew', () => {
  const cur = ORIG.replace(/\r\n/g, '\n').replace('x = 1', 'x = 1\n  z = 5\n  w = 6');
  const res = revertProcedure(ORIG, cur, 'sub:a');
  assert.equal(res.text, ORIG.replace(/\r\n/g, '\n'));
  assert.equal(/\r/.test(res.text), false);
});

test('T-WB-22: reverting an added procedure removes it with its separating blank line', () => {
  const cur = `${ORIG}\r\n\r\nSub New1()\r\nEnd Sub`;
  const res = revertProcedure(ORIG, cur, 'sub:new1');
  assert.equal(res.text, ORIG);
});

test('T-WB-22: reverting a removed procedure puts it back after the one that preceded it', () => {
  const cur = ORIG.replace('\r\nPublic Sub B()\r\n  y = 2\r\nEnd Sub\r\n', '');
  assert.deepEqual(matchProcedures(ORIG, cur).removed.map((x) => x.name), ['B']);
  const res = revertProcedure(ORIG, cur, 'sub:b');
  assert.deepEqual(status(matchProcedures(ORIG, res.text)), { A: 'same', B: 'same', C: 'same' });
});

test('T-WB-22: an unknown key is refused with a sentence', () => {
  const res = revertProcedure(ORIG, ORIG, 'sub:nope');
  assert.equal(res.ok, false);
  assert.ok(res.reason);
});

test('T-WB-22: two procedures with the same name and kind get distinct keys', () => {
  const o = 'Sub A()\nEnd Sub\nSub A()\nEnd Sub';
  const r = matchProcedures(o, o);
  assert.deepEqual(r.rows.map((x) => x.key), ['sub:a', 'sub:a#2']);
});
