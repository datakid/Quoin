import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIB, COVERAGE } from '../../src/core/m/library/index.js';
import { MFunction, MType, Thunk } from '../../src/core/m/values.js';
import { M_NAMES, M_CATEGORIES } from '../../src/ui/wb/m-names.js';

const kindOf = (v) => (v instanceof MFunction ? 'function' : v instanceof MType ? 'type' : v instanceof Thunk ? 'getter' : 'value');
const differs = (r) => {
  const v = LIB.get(r.name);
  if (v === undefined || r.kind !== kindOf(v) || r.status !== COVERAGE.get(r.name)) return true;
  if (!(v instanceof MFunction)) return 'params' in r;
  if (r.params.length !== v.params.length) return true;
  return v.params.some((p, i) => r.params[i] !== p.name || r.optional.includes(p.name) !== p.optional) || !!r.variadic !== !!v.variadic;
};

test('T-WB-20a: the generated name list equals the library, name for name and parameter for parameter', () => {
  assert.equal(M_NAMES.length, LIB.size);
  assert.deepEqual(M_NAMES.map((r) => r.name), [...LIB.keys()]);
  assert.deepEqual(M_NAMES.filter(differs).map((r) => r.name), []);
});

test('T-WB-20a: the list runs on its own, with a category per entry and no import of the engine', () => {
  const source = readFileSync(new URL('../../src/ui/wb/m-names.js', import.meta.url), 'utf8');
  assert.equal(/^import /m.test(source), false);
  assert.ok(M_NAMES.every((r) => r.name && r.kind && r.category && r.status));
  assert.deepEqual(M_CATEGORIES, [...new Set(M_NAMES.map((r) => r.category))]);
});

test('T-WB-20a: optional parameters are a subset of the parameters, and the unsupported names are exactly those of the library', () => {
  for (const r of M_NAMES) {
    if (!r.params) continue;
    assert.equal(new Set(r.params).size, r.params.length, r.name);
    assert.ok(r.optional.every((p) => r.params.includes(p)), r.name);
    assert.ok(r.optional.length < r.params.length || r.params.length === 0, r.name);
  }
  const unsupported = M_NAMES.filter((r) => r.status === 'unsupported').map((r) => r.name);
  assert.deepEqual(unsupported, [...COVERAGE].filter(([, s]) => s === 'unsupported').map(([n]) => n));
  const supported = new Set(M_NAMES.filter((r) => r.status !== 'unsupported').map((r) => r.name));
  assert.equal(supported.size, LIB.size - unsupported.length);
  assert.ok(supported.has('Text.Upper') && supported.has('#table') && supported.has('Int64.Type'));
  assert.ok(!supported.has('Sql.Database'));
});
