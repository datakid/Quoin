import { TOKENS } from '../recipe/recipe.js';

const KNOWN = new Set(TOKENS);
const ANY_BRACES = /\{[^{}]*\}/g;
const RESERVED_BRACES = /\{(?:file|unit)\.[^{}]*\}/g;

export const baseName = (name) => name.replace(/\.[^.]+$/, '');

export const folderOf = (relPath) => relPath.slice(0, relPath.lastIndexOf('/') + 1);

function tokenValues(file, unit) {
  return new Map([
    ['{file.name}', baseName(file.name)],
    ['{file.folder}', folderOf(file.relPath)],
    ['{unit.name}', unit.name],
    ['{unit.index}', String(unit.index)]
  ]);
}

export function substituteTokens(text, file, unit) {
  const values = tokenValues(file, unit);
  return String(text).replace(ANY_BRACES, (token) => (values.has(token) ? values.get(token) : token));
}

export function unknownQueryTokens(text) {
  const found = [];
  for (const token of String(text).match(RESERVED_BRACES) || []) if (!KNOWN.has(token) && !found.includes(token)) found.push(token);
  return found;
}
