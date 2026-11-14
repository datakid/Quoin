import { LIB, COVERAGE } from '../m/library/index.js';

export function supportedNames() {
  return new Set([...LIB.keys()].filter((k) => COVERAGE.get(k) !== 'unsupported'));
}
