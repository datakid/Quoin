import { parseRecipe } from '../batch/recipe/recipe.js';
import { saveRecipeFile } from './recipe-files.js';

export const RECIPES_KEY = 'quoin.recipes';
export const RECENT_KEY = 'quoin.recent';
export const MAX_RECIPES = 50;
export const MAX_RECENT = 10;
export const MAX_STORE_CHARS = 1000000;
const MAX_SET_NAME = 80;

const lower = (s) => s.toLowerCase();
const byName = (a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const wellFormed = (e) => !!e && typeof e === 'object' && typeof e.name === 'string' && typeof e.text === 'string';
const charsOf = (entries) => entries.reduce((n, e) => n + e.name.length + e.text.length, 0);
const validSetName = (name) => typeof name === 'string' && name.length > 0 && name.length <= MAX_SET_NAME && !/[\\/\u0000-\u001f\u007f]/.test(name);

export function createRecipeStore(storage) {
  const read = (key) => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      return raw === null || raw === undefined ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const write = (key, value) => {
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  const rawRecipes = () => {
    const stored = read(RECIPES_KEY);
    return Array.isArray(stored) ? stored.filter(wellFormed) : [];
  };

  return {
    listRecipes() {
      const stored = read(RECIPES_KEY);
      if (!Array.isArray(stored)) return { recipes: [], skipped: 0 };
      const recipes = [];
      let skipped = 0;
      for (const e of stored) {
        const parsed = wellFormed(e) ? parseRecipe(e.text) : null;
        if (parsed && parsed.ok) recipes.push({ name: e.name, kind: parsed.recipe.recipe, recipe: parsed.recipe });
        else skipped++;
      }
      return { recipes: recipes.sort(byName), skipped };
    },

    saveRecipe(recipe) {
      if (!recipe || typeof recipe !== 'object') return { ok: false, code: 'recipe.invalid' };
      const name = typeof recipe.name === 'string' ? recipe.name.trim() : '';
      if (!name) return { ok: false, code: 'recipe.name' };
      const file = saveRecipeFile(recipe);
      if (!file.ok) return { ok: false, code: file.code };
      const others = rawRecipes().filter((e) => lower(e.name) !== lower(name));
      const entries = [...others, { name, text: file.text }];
      if (entries.length > MAX_RECIPES || charsOf(entries) > MAX_STORE_CHARS) return { ok: false, code: 'recipe.storeFull' };
      return write(RECIPES_KEY, entries) ? { ok: true } : { ok: false, code: 'recipe.storeFull' };
    },

    deleteRecipe(name) {
      const entries = rawRecipes();
      const kept = entries.filter((e) => lower(e.name) !== lower(String(name)));
      if (kept.length === entries.length) return { ok: true, removed: false };
      return write(RECIPES_KEY, kept) ? { ok: true, removed: true } : { ok: false, code: 'recipe.storeFull' };
    },

    recentSets() {
      const stored = read(RECENT_KEY);
      return Array.isArray(stored) ? stored.filter((n) => typeof n === 'string') : [];
    },

    rememberSet(name) {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!validSetName(clean)) return { ok: false, code: 'recent.name' };
      const names = [clean, ...this.recentSets().filter((n) => lower(n) !== lower(clean))].slice(0, MAX_RECENT);
      return write(RECENT_KEY, names) ? { ok: true } : { ok: false, code: 'recent.store' };
    },

    clear() {
      if (!storage) return;
      for (const key of [RECIPES_KEY, RECENT_KEY]) {
        try {
          storage.removeItem(key);
        } catch {
          continue;
        }
      }
    }
  };
}
