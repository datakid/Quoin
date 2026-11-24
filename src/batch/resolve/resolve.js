import { unknownTokens } from '../recipe/recipe.js';
import { baseName, fileContext, templateFor, unknownQueryTokens } from './tokens.js';
import { alignSourceFor } from './align-source.js';
import { buildMatcher, matchPins, pinnedUnits, ruleUnits, unknownNonEmpty, worksheets } from './scope.js';

export { inspectNeeds } from './scope.js';
export { alignSourceFor } from './align-source.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const RESOLVED = ['collect', 'inject', 'replace', 'transform', 'align'];
const DEFAULT_FILE_NAME = '{file.name}__{unit.name}.xlsx';
const DEFAULT_SHEET_NAME = 'Result';
const DEFAULT_COMBINED_NAME = '{file.name}__{unit.name}';
const RANGE_TEXT = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/;
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

function injectNames(index, inject, matcher) {
  if (inject.op === 'add' || inject.match !== 'pattern') return [inject.name];
  return (inject.target === 'module' ? index.modules : index.queries).filter((m) => matcher.test(m.name)).map((m) => m.name);
}

const memberAction = (unit, op, type, name) => ({ unit, op, target: { type, name }, compute: null, output: null, replaces: null });

const notApplicable = (index, detail) => ({ fileId: index.id, source: 'rule', units: [], actions: [], skipped: { code: 'skip.notApplicable', detail } });

function planMemberFile(index, members, detail) {
  if (!members.length) return notApplicable(index, detail);
  const unit = workbookUnit(index);
  return { fileId: index.id, source: 'rule', units: [unit], actions: members.map(([op, type, name]) => memberAction(unit, op, type, name)), skipped: null };
}

function planInjectFile(index, ctx) {
  if (index.status === 'refused') return skippedFile(index);
  const { inject } = ctx.recipe;
  return planMemberFile(index, injectNames(index, inject, ctx.matcher).map((name) => [inject.op, inject.target, name]), inject.name);
}

function planReplaceFile(index, ctx) {
  if (index.status === 'refused') return skippedFile(index);
  const { replace } = ctx.recipe;
  const members = [];
  if (replace.in.includes('m')) for (const q of index.queries) members.push(['replaceText', 'query', q.name]);
  if (replace.in.includes('vba')) for (const m of index.modules) members.push(['replaceText', 'module', m.name]);
  return planMemberFile(index, members, replace.find);
}

function planAlignFile(index, ctx) {
  if (index.status === 'refused') return skippedFile(index);
  const { align } = ctx.recipe;
  const has = (align.target === 'module' ? index.modules : index.queries).some((m) => m.name === align.name);
  return planMemberFile(index, has ? [['align', align.target, align.name]] : [], align.name);
}

function transformActions(ctx, context, units) {
  const { recipe, fill } = ctx;
  return units.map((unit) => ({
    unit,
    op: 'transform',
    target: { type: TARGET_TYPE[unit.kind], name: unit.name },
    compute: recipe.compute,
    output: recipe.output ? { mode: recipe.output.mode, name: fill ? fill(context, unit) : null } : null,
    replaces: null
  }));
}

function planTransformFile(index, ctx) {
  if (index.status === 'refused') return skippedFile(index);
  const { scope } = ctx;
  const sheets = worksheets(index);
  let units;
  let source = 'rule';
  if (scope.type === 'workbook') units = [workbookUnit(index)];
  else if (ctx.pins.has(index.id)) {
    const found = pinnedUnits(index, scope, ctx.pins.get(index.id).units, sheets);
    units = found.units;
    source = 'pin';
    if (found.missing.length) ctx.orphans.push({ file: index.relPath, units: found.missing });
  } else {
    units = ruleUnits(index, scope, ctx.matcher, sheets);
    if (unknownNonEmpty(index, scope, sheets)) ctx.errors.push({ code: 'scope.needsInspect', fileId: index.id, detail: 'nonEmpty' });
  }
  if (ctx.inPlace && scope.type !== 'workbook') {
    const seen = new Set();
    for (const unit of units) {
      const target = unit.kind === 'sheet' ? unit.name : (index.tables.find((t) => t.name === unit.name) || {}).sheet;
      if (seen.has(target) && !ctx.errors.some((e) => e.code === 'output.overlap' && e.fileId === index.id && e.detail === target)) ctx.errors.push({ code: 'output.overlap', fileId: index.id, detail: target });
      seen.add(target);
    }
  }
  return {
    fileId: index.id,
    source,
    units,
    actions: transformActions(ctx, fileContext(index), units),
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

function recipeErrors(recipe, indexes) {
  const errors = [];
  if (recipe.output && typeof recipe.output.name === 'string') for (const token of unknownTokens(recipe.output.name)) errors.push({ code: 'recipe.token', detail: token });
  if (recipe.recipe === 'inject' && typeof recipe.inject.text === 'string') for (const token of unknownQueryTokens(recipe.inject.text)) errors.push({ code: 'recipe.token', detail: token });
  if (recipe.recipe === 'inject' && recipe.inject.op === 'add' && recipe.inject.match === 'pattern') errors.push({ code: 'recipe.patternAdd', detail: recipe.inject.name });
  if (recipe.recipe === 'align' && !alignSourceFor(recipe.align, indexes)) errors.push({ code: 'align.noSource', detail: recipe.align.hash });
  if (recipe.recipe === 'transform') {
    for (const token of unknownQueryTokens(recipe.query.m)) errors.push({ code: 'recipe.token', detail: token });
    if (recipe.compute === 'excel') {
      if (!recipe.output || typeof recipe.output.name !== 'string' || !recipe.output.name.length) errors.push({ code: 'output.nameRequired', detail: null });
      if (recipe.output && recipe.output.mode !== 'inPlace') errors.push({ code: 'output.excelMode', detail: recipe.output.mode });
    } else if (recipe.output && recipe.output.mode === 'inPlace') {
      const range = recipe.output.range;
      if (range === undefined || range === null || range === '') errors.push({ code: 'output.rangeRequired', detail: null });
      else if (!RANGE_TEXT.test(range)) errors.push({ code: 'output.range', detail: range });
      if (recipe.scope.type === 'workbook') errors.push({ code: 'output.inPlaceScope', detail: null });
    }
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
  const errors = recipeErrors(recipe, indexes);
  const orphans = [...pins.orphans];
  let files;
  if (recipe.recipe === 'transform') {
    const matcher = buildMatcher(recipe.scope);
    if (matcher.error) errors.push(matcher.error);
    const template = recipe.output && typeof recipe.output.name === 'string' ? recipe.output.name : recipe.output && recipe.output.mode === 'newFile' ? DEFAULT_FILE_NAME : recipe.output && recipe.output.mode === 'newSheet' ? DEFAULT_SHEET_NAME : recipe.output && recipe.output.mode === 'combined' ? DEFAULT_COMBINED_NAME : null;
    const ctx = { recipe, scope: recipe.scope, inPlace: Boolean(recipe.output && recipe.output.mode === 'inPlace' && recipe.compute !== 'excel'), matcher, pins: pins.matched, errors, orphans, fill: template === null ? null : templateFor(template) };
    files = ordered.map((ix) => planTransformFile(ix, ctx));
  } else if (recipe.recipe === 'inject') {
    const matcher = buildMatcher({ match: recipe.inject.match, pattern: recipe.inject.name });
    if (matcher.error) errors.push(matcher.error);
    files = ordered.map((ix) => planInjectFile(ix, { recipe, matcher }));
  } else if (recipe.recipe === 'replace') files = ordered.map((ix) => planReplaceFile(ix, { recipe }));
  else if (recipe.recipe === 'align') files = ordered.map((ix) => planAlignFile(ix, { recipe }));
  else files = ordered.map(planCollectFile);
  return { recipe: structuredClone(recipe), now, createdBy: 'resolve', summary: summarise(files), files, orphanPins: orphans, errors };
}
