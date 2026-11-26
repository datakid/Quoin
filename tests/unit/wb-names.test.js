import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderNames, NAMES_PATH, namesRows } from '../../scripts/build-names.mjs';
import { M_NAMES } from '../../src/ui/wb/m-names.js';
import { LIB } from '../../src/core/m/library/index.js';
import { supportedNames } from '../../src/core/wb/lib-names.js';

test('T-WB-20a: the generated names file is exactly what the build script writes from the library', () => {
  assert.equal(readFileSync(NAMES_PATH, 'utf8'), renderNames());
});

test('T-WB-20a: every supported library function is listed once with its parameters and optional flags, and nothing else', () => {
  const supported = supportedNames();
  assert.deepEqual(new Set(M_NAMES.map((r) => r[0])), supported);
  assert.equal(M_NAMES.length, supported.size);
  for (const [name, params] of M_NAMES) {
    const fn = LIB.get(name);
    const expected = fn && fn.params ? fn.params.map((p) => (p.optional ? `?${p.name}` : p.name)).join(',') : null;
    assert.equal(params, expected, name);
  }
});

test('T-WB-20a: constants such as Order.Descending are listed without parameters, functions with them', () => {
  const byName = new Map(M_NAMES.map((r) => [r[0], r]));
  assert.equal(byName.get('Order.Descending')[1], null);
  assert.equal(byName.get('Table.SelectRows')[1], 'table,condition');
  assert.equal(byName.get('Table.AddColumn')[1], 'table,newColumnName,columnGenerator,?columnType');
});

test('T-WB-20a: each row has a category taken from the name, and the rows are sorted', () => {
  for (const [name, , category] of M_NAMES) assert.equal(category, name.includes('.') ? name.slice(0, name.indexOf('.')) : 'Value');
  const sorted = [...M_NAMES].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.deepEqual(M_NAMES, sorted);
  assert.deepEqual(namesRows(), M_NAMES);
});
