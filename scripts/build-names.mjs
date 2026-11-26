import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LIB, COVERAGE } from '../src/core/m/library/index.js';

export const NAMES_PATH = 'src/ui/wb/m-names.js';

export function namesRows() {
  return [...LIB.entries()]
    .filter(([name]) => COVERAGE.get(name) !== 'unsupported')
    .map(([name, fn]) => {
      const dot = name.indexOf('.');
      return [name, fn && fn.params ? fn.params.map((p) => (p.optional ? `?${p.name}` : p.name)).join(',') : null, dot > 0 ? name.slice(0, dot) : 'Value'];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function renderNames() {
  const rows = namesRows().map((r) => `  ${JSON.stringify(r)}`);
  return `export const M_NAMES = [\n${rows.join(',\n')}\n];\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(NAMES_PATH, renderNames());
  console.log(`${NAMES_PATH} written`);
}
