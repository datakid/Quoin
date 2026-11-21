import { normalizeQueryText, toViewText } from '../../core/pq/section.js';
import { checkSection } from '../../core/m/engine.js';
import { QuoinError } from '../../core/errors.js';
import { substituteTokens, unknownQueryTokens } from '../resolve/tokens.js';
import { sha256Bytes, sha256Text } from '../index/hash.js';
import { reportRow } from './changes.js';

const LOAD_TARGETS = new Set(['table', 'model']);

async function decide(wb, action, recipe, file, taken) {
  const unit = action.unit;
  if (unit.kind === 'sheet') return { verdict: 'refused', reason_code: 'refused.sheetUnit' };
  const name = action.output && action.output.name;
  if (!name) return { verdict: 'refused', reason_code: 'refused.noName' };
  const query = wb.queries.find((q) => q.name === name);
  if (!query) return { verdict: 'refused', reason_code: 'refused.noQuery' };
  if (!LOAD_TARGETS.has(query.load.kind)) return { verdict: 'refused', reason_code: 'refused.noLoadTarget' };
  if (taken.has(name)) return { verdict: 'refused', reason_code: 'refused.overlap' };
  const unknown = unknownQueryTokens(recipe.query.m);
  if (unknown.length) return { verdict: 'failed', reason_code: 'recipe.token', reason: unknown.join(', ') };
  const text = normalizeQueryText(substituteTokens(recipe.query.m, file, unit));
  const problem = checkSection(`section Section1;\r\n\r\nshared Q =\r\n${text};`);
  if (problem) return { verdict: 'failed', reason_code: 'unit.parse', reason: `${problem.message} (line ${Math.max(1, problem.line - 3)}, column ${problem.col})` };
  return { name, text, oldHash: await sha256Text(normalizeQueryText(query.original)), newHash: await sha256Text(text) };
}

export async function executeOnOpen(wb, filePlan, recipe, { meta, runId = '', apply } = {}) {
  const started = performance.now();
  const file = meta || { name: wb.fileName, relPath: wb.fileName };
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  const taken = new Set();
  const replace = new Map();
  const decisions = [];
  for (const action of filePlan.actions) {
    const d = await decide(wb, action, recipe, file, taken);
    decisions.push({ action, d });
    if (d.name) {
      taken.add(d.name);
      replace.set(d.name, toViewText(d.text));
    }
  }
  let written = null;
  let failure = null;
  if (replace.size && typeof apply !== 'function') throw new TypeError('Excel compute needs the change writer');
  if (replace.size) {
    try {
      written = await apply({ queries: { replace }, refreshOnLoad: new Set(replace.keys()) });
    } catch (e) {
      if (!(e instanceof QuoinError)) throw e;
      failure = { verdict: e.code === 'write.selfcheck' ? 'not-released' : 'failed', reason_code: e.code };
    }
  }
  const sha256 = written ? await sha256Bytes(written.bytes) : null;
  const rows = decisions.map(({ action, d }) => {
    const common = { run_id: runId, duration_ms: Math.round(performance.now() - started) };
    if (!d.name) return reportRow(file, action, recipe, { ...common, verdict: d.verdict, reason_code: d.reason_code, reason: d.reason || '', verified: false });
    if (failure) return reportRow(file, action, recipe, { ...common, ...failure, verified: false });
    return reportRow(file, action, recipe, { ...common, verdict: 'changed', reason_code: '', verified: true, output: `${written.name} [query ${d.name}]`, old_hash: d.oldHash, new_hash: d.newHash });
  });
  return { fileId: filePlan.fileId, outputs: written ? [{ unit: null, name: written.name, bytes: written.bytes, sha256 }] : [], bytes: written ? written.bytes : null, sha256, sheetParts: [], rows, failures: [], warnings };
}
