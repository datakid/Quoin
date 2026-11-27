import { TOKENS, unknownTokens } from '../recipe/recipe.js';

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

export function fileContext(file) {
  return { name: baseName(file.name), folder: folderOf(file.relPath) };
}

export function templateFor(text) {
  const parts = String(text).split(/(\{[^{}]*\})/);
  return (context, unit) => {
    let out = '';
    for (const part of parts) {
      switch (part) {
        case '{file.name}':
          out += context.name;
          break;
        case '{file.folder}':
          out += context.folder;
          break;
        case '{unit.name}':
          out += unit.name;
          break;
        case '{unit.index}':
          out += unit.index;
          break;
        default:
          out += part;
      }
    }
    return out;
  };
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

export function withInjectTokens(recipe, file) {
  if (recipe.recipe !== 'inject' || typeof recipe.inject.text !== 'string') return recipe;
  const unit = { name: baseName(file.name), index: 1 };
  return { ...recipe, inject: { ...recipe.inject, text: substituteTokens(recipe.inject.text, file, unit) } };
}

export function recipeTokens(recipe) {
  const name = recipe.output && typeof recipe.output.name === 'string' ? recipe.output.name : '';
  const m = recipe.recipe === 'transform' && recipe.query && typeof recipe.query.m === 'string' ? recipe.query.m : '';
  const text = recipe.recipe === 'inject' && typeof recipe.inject.text === 'string' ? recipe.inject.text : '';
  const used = TOKENS.filter((t) => name.includes(t) || m.includes(t) || text.includes(t));
  const unknown = [...unknownTokens(name)];
  for (const t of [...unknownQueryTokens(m), ...unknownQueryTokens(text)]) if (!unknown.includes(t)) unknown.push(t);
  return { used, unknown };
}
