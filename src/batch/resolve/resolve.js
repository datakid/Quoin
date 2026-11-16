import { unknownTokens } from '../recipe/recipe.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const baseName = (name) => name.replace(/\.[^.]+$/, '');

function planFile(index) {
  if (index.status === 'refused') return { fileId: index.id, source: 'rule', units: [], actions: [], skipped: { code: index.refused.code, detail: null } };
  const unit = { fileId: index.id, kind: 'workbook', name: baseName(index.name), index: 1 };
  const action = (type, name) => ({ unit, op: 'collect', target: { type, name }, compute: null, output: null, replaces: null });
  return {
    fileId: index.id,
    source: 'rule',
    units: [unit],
    actions: [...index.queries.map((q) => action('query', q.name)), ...index.modules.map((m) => action('module', m.name))],
    skipped: null
  };
}

function summarise(files) {
  const usable = files.filter((f) => f.units.length > 0);
  const counts = new Map();
  for (const f of usable) counts.set(f.units.length, (counts.get(f.units.length) || 0) + 1);
  return {
    files: usable.length,
    units: usable.reduce((n, f) => n + f.units.length, 0),
    groups: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([unitsPerFile, n]) => ({ unitsPerFile, files: n }))
  };
}

export function resolvePlan(recipe, indexes, { now } = {}) {
  if (typeof now !== 'string' || !ISO_UTC.test(now)) throw new TypeError('now must be a frozen ISO UTC time');
  if (recipe.recipe !== 'collect') throw new Error(`${recipe.recipe} recipes are not resolved yet`);
  for (const ix of indexes) if (ix.status !== 'ready' && ix.status !== 'refused') throw new Error(`unexpected index status ${ix.status}`);
  const ordered = [...indexes].sort((a, b) => compare(a.relPath, b.relPath) || compare(a.id, b.id));
  const files = ordered.map(planFile);
  const present = new Set(indexes.map((ix) => ix.relPath));
  const orphanPins = (recipe.overrides || []).filter((o) => !present.has(o.path)).map((o) => ({ file: o.path, units: [...o.units] }));
  const errors = [];
  if (recipe.output && typeof recipe.output.name === 'string') for (const token of unknownTokens(recipe.output.name)) errors.push({ code: 'recipe.token', detail: token });
  return { recipe: structuredClone(recipe), now, createdBy: 'resolve', summary: summarise(files), files, orphanPins, errors };
}
