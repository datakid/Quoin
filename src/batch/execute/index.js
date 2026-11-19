import { QuoinError } from '../../core/errors.js';
import { applyChangeSet } from '../../core/save.js';
import { checkSection } from '../../core/m/engine.js';
import { sha256Bytes } from '../index/hash.js';
import { zipClock } from './collect.js';
import { planChanges, reportRow } from './changes.js';

export async function executeFile(wb, filePlan, { now, recipe, meta, runId = '' }) {
  const started = performance.now();
  const file = meta || { name: wb.fileName, relPath: wb.fileName };
  const warnings = wb.warnings.map((w) => (w.part ? { code: w.code, part: w.part } : { code: w.code }));
  const { changeSet, outcomes } = await planChanges(wb, filePlan, recipe);
  const rowsFor = (settle) =>
    filePlan.actions.map((action, i) => {
      const o = outcomes[i];
      return reportRow(file, action, recipe, { run_id: runId, old_hash: o.old_hash, new_hash: o.new_hash, reason: o.reason || '', ...settle(o), duration_ms: Math.round(performance.now() - started) });
    });
  const changes = outcomes.filter((o) => o.change).map((o) => o.change);
  const none = { fileId: filePlan.fileId, bytes: null, sha256: null, changes: [], warnings };
  if (!changes.length) return { ...none, rows: rowsFor((o) => ({ verdict: o.verdict, reason_code: o.reason_code, verified: o.verdict === 'unchanged' })) };
  let written;
  try {
    written = await applyChangeSet(wb, changeSet, { now: zipClock(now), refreshOnLoad: false, checkSection });
  } catch (e) {
    if (!(e instanceof QuoinError)) throw e;
    const verdict = e.code === 'write.selfcheck' ? 'not-released' : 'failed';
    return { ...none, rows: rowsFor((o) => (o.change ? { verdict, reason_code: e.code, verified: false } : { verdict: o.verdict, reason_code: o.reason_code, verified: o.verdict === 'unchanged' })) };
  }
  const sha256 = await sha256Bytes(written.bytes);
  return { fileId: filePlan.fileId, bytes: written.bytes, sha256, changes, warnings, rows: rowsFor((o) => ({ verdict: o.verdict, reason_code: o.reason_code, verified: o.verdict === 'changed' || o.verdict === 'unchanged' })) };
}
