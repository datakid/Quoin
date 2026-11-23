import { parseRecipe, serialiseRecipe } from '../batch/recipe/recipe.js';
import { sanitizeFileName } from '../core/filename.js';

export const RECIPE_FILE_MAX = 256 * 1024;
export const RECIPE_FILE_SUFFIX = '.quoin-recipe.json';

export const isRecipeFileName = (name) => typeof name === 'string' && name.toLowerCase().endsWith(RECIPE_FILE_SUFFIX) && name.length > RECIPE_FILE_SUFFIX.length;

export function recipeFileName(recipe) {
  const named = typeof recipe.name === 'string' ? recipe.name.trim() : '';
  return sanitizeFileName(named || recipe.recipe, RECIPE_FILE_SUFFIX);
}

function binaryPath(value, path) {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') return path;
  if (type !== 'object') return null;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) || (typeof Blob !== 'undefined' && value instanceof Blob)) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = binaryPath(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const found = binaryPath(value[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

export function saveRecipeFile(recipe) {
  const binary = binaryPath(recipe, '');
  if (binary) return { ok: false, code: 'recipe.binary', detail: binary };
  let text;
  try {
    text = serialiseRecipe(recipe);
  } catch (e) {
    return { ok: false, code: 'recipe.invalid', detail: String(e.message).replace(/^cannot serialise an invalid recipe: /, '') };
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > RECIPE_FILE_MAX) return { ok: false, code: 'recipe.tooLarge', detail: `${bytes.length}` };
  return { ok: true, name: recipeFileName(recipe), text, bytes };
}

export async function loadRecipeFile(file) {
  if (file.size > RECIPE_FILE_MAX) return { ok: false, code: 'recipe.tooLarge', detail: `${file.size}` };
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, code: 'recipe.invalid', detail: 'the file could not be read' };
  }
  if (bytes.length > RECIPE_FILE_MAX) return { ok: false, code: 'recipe.tooLarge', detail: `${bytes.length}` };
  if (bytes.includes(0)) return { ok: false, code: 'recipe.binary', detail: 'not text' };
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'recipe.binary', detail: 'not text' };
  }
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return { ok: false, code: 'recipe.binary', detail: 'not text' };
  const parsed = parseRecipe(text.replace(/^\ufeff/, ''));
  return parsed.ok ? { ...parsed, name: file.name } : parsed;
}
