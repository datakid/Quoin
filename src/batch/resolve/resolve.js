import { unknownTokens } from '../recipe/recipe.js';
import { baseName, substituteTokens, unknownQueryTokens } from './tokens.js';
import { buildMatcher, matchPins, pinnedUnits, ruleUnits, unknownNonEmpty } from './scope.js';

export { inspectNeeds } from './scope.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const RESOLVED = ['collect', 'transform'];
const TARGET_TYPE = { workbook: 'sheet', sheet: 'sheet', table: 'range' };

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const skippedFile = (index) => ({ fileId: index.id, source: 'rule', units: [], actions: [], skipped: { code: index.refused.code, detail: null } });

const workbookUnit = (index) => ({ fileId: index.id, kind: 'workbook', name: baseName(index.name), index: 1 });

function planCollectFile(index) {
  if (index.status === 'refused') return skippedFile(index);
  const unit = workbookUnit(index);
  const action = (type, name) => ({ unit, op: 'collect', target: { type, name }, compute: null, output: null, replaces: null });
  return {
    fileId: index.id,
    source: 'rule',
    units: [unit],
    actions: [...index.queries.map((q) => action('query', q.name)), ...index.modules.map((m) => action('module', m.name))],
    skipped: null
  };
}

function outputFor(recipe, index, unit) {
  if (!recipe.output) return null;
  const template = recipe.output.name;
  return { mode: recipe.output.mode, name: typeof template === 'string' ? substituteTokens(template, index, unit) : null };
}

function transformActions(recipe, index, units) {
  return units.map((unit) => ({ unit, op: 'transform', target: { type: TARGET_TYPE[unit.kind], name: unit.name }, compute: recipe.compute, output: outputFor(recipe, index, unit), replaces: null }));
}

function planTransformFile(index, ctx) {
  if (index.status === 'refused') return skippedFile(index);
  const { recipe, scope } = ctx;
  let units;
  let source = 'rule';
  if (scope.type === 'workbook') units = [workbookUnit(index)];
  else if (ctx.pins.has(index.id)) {
    const found = pinnedUnits(index, scope, ctx.pins.get(index.id).units);
    units = found.units;
    source = 'pin';
    if (found.missing.length) ctx.orphans.push({ file: index.relPath, units: found.missing });
  } else {
    units = ruleUnits(index, scope, ctx.matcher);
    if (unknownNonEmpty(index, scope)) ctx.errors.push({ code: 'scope.needsInspect', fileId: index.id, detail: 'nonEmpty' });
  }
  return {
    fileId: index.id,
    source,
    units,
    actions: transformActions(recipe, index, units),
    skipped: units.length ? null : { code: 'skip.noMatchingUnit', detail: null }
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

function recipeErrors(recipe) {
  const errors = [];
  if (recipe.output && typeof recipe.output.name === 'string') for (const token of unknownTokens(recipe.output.name)) errors.push({ code: 'recipe.token', detail: token });
  if (recipe.recipe === 'transform') {
    for (const token of unknownQueryTokens(recipe.query.m)) errors.push({ code: 'recipe.token', detail: token });
    if (recipe.scope.type === 'sheets' && recipe.scope.onlyWithHeader) errors.push({ code: 'scope.headerOnSheets', detail: 'onlyWithHeader' });
  }
  return errors;
}

export function resolvePlan(recipe, indexes, { now } = {}) {
  if (typeof now !== 'string' || !ISO_UTC.test(now)) throw new TypeError('now must be a frozen ISO UTC time');
  if (!RESOLVED.includes(recipe.recipe)) throw new Error(`${recipe.recipe} recipes are not resolved yet`);
  for (const ix of indexes) if (ix.status !== 'ready' && ix.status !== 'refused') throw new Error(`unexpected index status ${ix.status}`);
  const ordered = [...indexes].sort((a, b) => compare(a.relPath, b.relPath) || compare(a.id, b.id));
  const pins = matchPins(recipe.overrides || [], ordered);
  const errors = recipeErrors(recipe);
  const orphans = [...pins.orphans];
  let files;
  if (recipe.recipe === 'transform') {
    const matcher = buildMatcher(recipe.scope);
    if (matcher.error) errors.push(matcher.error);
    const ctx = { recipe, scope: recipe.scope, matcher, pins: pins.matched, errors, orphans };
    files = ordered.map((ix) => planTransformFile(ix, ctx));
  } else files = ordered.map(planCollectFile);
  return { recipe: structuredClone(recipe), now, createdBy: 'resolve', summary: summarise(files), files, orphanPins: orphans, errors };
}
