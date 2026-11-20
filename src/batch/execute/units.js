import { runOnce, MTable } from '../../core/m/engine.js';
import { kindOf } from '../../core/m/values.js';
import { tableCells } from '../../core/sheet/grid.js';
import { buildSnapshot, buildUnitSnapshot } from '../../core/snapshot.js';
import { substituteTokens, unknownQueryTokens } from '../resolve/tokens.js';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const QUERY = 'Result';
const HEAD = 'section Section1;\r\n\r\nshared Result =\r\n';
const HEAD_LINES = 3;

export function prepareQuery(m, file, unit) {
  const text = substituteTokens(m, file, unit);
  const unknown = unknownQueryTokens(m);
  if (unknown.length) return { ok: false, text, error: { code: 'recipe.token', detail: unknown.join(', ') } };
  return { ok: true, text, error: null };
}

const failed = (unit, m, error, status = 'error') => ({ unit, status, m, table: null, outputName: null, error, flags: [], durationMs: 0 });

function describe(unit, m, r) {
  switch (r.status) {
    case 'ok':
      if (!(r.value instanceof MTable)) return failed(unit, m, { code: 'unit.notTable', detail: kindOf(r.value) });
      return { unit, status: 'ok', m, table: r.value, outputName: null, error: null, flags: r.flags, durationMs: r.durationMs };
    case 'parse-error':
      return failed(unit, m, { code: 'unit.parse', message: r.error.message, line: Math.max(1, r.error.line - HEAD_LINES), col: r.error.col });
    case 'error':
      return { ...failed(unit, m, { code: 'unit.error', reason: r.error.reason, message: r.error.message, detail: r.error.detail }), flags: r.flags || [] };
    case 'stopped':
      return failed(unit, m, { code: r.code, detail: r.detail === undefined ? null : r.detail }, 'stopped');
    default:
      return failed(unit, m, { code: 'unit.binding', kind: r.kind, detail: r.key });
  }
}

export async function runUnit(wb, file, unit, recipe, { now, base, localOffsetMin } = {}) {
  if (typeof now !== 'string' || !ISO_UTC.test(now)) throw new TypeError('now must be a frozen ISO UTC time');
  const prepared = prepareQuery(recipe.query.m, file, unit);
  if (!prepared.ok) return failed(unit, prepared.text, prepared.error);
  const built = await buildUnitSnapshot(wb, unit, { base });
  if (built.error) return failed(unit, prepared.text, built.error);
  const options = { sectionText: `${HEAD}${prepared.text};`, queryName: QUERY, snapshot: built.snapshot, culture: recipe.more.culture, limits: recipe.more.limits, now, previewRows: 1 };
  if (localOffsetMin !== undefined) options.localOffsetMin = localOffsetMin;
  return describe(unit, prepared.text, runOnce(options));
}

function outputSource(name, table, cultureName) {
  return { name, kind: 'output', columns: [...table.columns], rows: tableCells(table, cultureName), queryLoaded: false };
}

function plannedOutputName(filePlan, unit) {
  const action = filePlan.actions.find((a) => a.op === 'transform' && a.unit.index === unit.index);
  return action && action.output && typeof action.output.name === 'string' && action.output.name.length > 0 ? action.output.name : null;
}

export async function runFileUnits(wb, file, filePlan, recipe, { now, localOffsetMin, isCancelled, onUnit } = {}) {
  const units = [...filePlan.units].sort((a, b) => a.index - b.index);
  const base = await buildSnapshot(wb);
  const outputs = new Map();
  const runs = [];
  for (const unit of units) {
    if (isCancelled && isCancelled()) return { runs, cancelled: true };
    const clash = [...outputs.keys()].find((name) => base.sources.some((s) => s.name === name));
    let run;
    if (clash !== undefined) run = failed(unit, prepareQuery(recipe.query.m, file, unit).text, { code: 'unit.nameCollision', detail: clash });
    else {
      const withOutputs = outputs.size ? { ...base, sources: [...base.sources, ...outputs.values()] } : base;
      run = await runUnit(wb, file, unit, recipe, { now, base: withOutputs, localOffsetMin });
    }
    const name = plannedOutputName(filePlan, unit);
    if (run.status === 'ok' && name !== null) {
      run.outputName = name;
      if (runs.length + 1 < units.length) outputs.set(name, outputSource(name, run.table, recipe.more.culture));
    }
    runs.push(run);
    if (onUnit) onUnit(run, runs.length, units.length);
  }
  return { runs, cancelled: false };
}
