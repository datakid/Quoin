import { writeFileSync } from 'node:fs';
import { LIB, COVERAGE } from '../src/core/m/library/index.js';
import { MFunction, MType, Thunk } from '../src/core/m/values.js';

const kindOf = (v) => (v instanceof MFunction ? 'function' : v instanceof MType ? 'type' : v instanceof Thunk ? 'getter' : 'value');
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (xs) => `[${xs.map(quote).join(', ')}]`;

const rows = [...LIB].map(([name, v]) => {
  const dot = name.indexOf('.');
  const row = { name, kind: kindOf(v), category: dot < 0 ? 'Constructor' : name.slice(0, dot), status: COVERAGE.get(name) };
  if (v instanceof MFunction) {
    row.params = v.params.map((p) => p.name);
    row.optional = v.params.filter((p) => p.optional).map((p) => p.name);
    if (v.variadic) row.variadic = true;
  }
  return row;
});

const categories = [...new Set(rows.map((r) => r.category))];
const line = (r) => {
  const head = `{ name: ${quote(r.name)}, kind: ${quote(r.kind)}, category: ${quote(r.category)}, status: ${quote(r.status)}`;
  if (!r.params) return `${head} }`;
  return `${head}, params: ${list(r.params)}, optional: ${list(r.optional)}${r.variadic ? ', variadic: true' : ''} }`;
};
const text = `export const M_NAMES = [\n${rows.map((r) => `  ${line(r)}`).join(',\n')}\n];\n\nexport const M_CATEGORIES = ${list(categories)};\n\nexport function supportedNames() {\n  return new Set(M_NAMES.filter((n) => n.status !== 'unsupported').map((n) => n.name));\n}\n`;

writeFileSync(new URL('../src/ui/wb/m-names.js', import.meta.url), text);
console.log(`src/ui/wb/m-names.js written: ${rows.length} names in ${categories.length} categories`);
