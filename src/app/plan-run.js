import { applyMessage } from '../batch/protocol.js';
import { resolvePlan, alignSourceFor } from '../batch/resolve/resolve.js';
import { failedResult } from '../batch/execute/index.js';
import { reportRows } from './outputs.js';
import { combineOutputs, labelCombined } from '../batch/execute/combine.js';
import { zipClock } from '../batch/execute/collect.js';
import { indexesOf, inflatedEstimate } from './set-indexes.js';
import { sha256Text } from '../batch/index/hash.js';

const WRITE_RECIPES = ['inject', 'replace', 'align'];

export function previewSupport(recipe) {
  if (WRITE_RECIPES.includes(recipe.recipe)) return { ok: true };
  if (recipe.recipe !== 'transform') return { ok: false, why: 'kind' };
  if (recipe.compute === 'excel') return { ok: false, why: 'compute' };
  if (recipe.output && ['newFile', 'newSheet', 'combined'].includes(recipe.output.mode)) return { ok: true };
  return { ok: false, why: 'output', mode: recipe.output ? recipe.output.mode : '' };
}
const VERDICTS = ['changed', 'unchanged', 'skipped', 'refused', 'failed', 'cancelled', 'not-released'];

const countRows = (rows) => {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const r of rows) if (r.verdict in counts) counts[r.verdict]++;
  return counts;
};

const signedFiles = (perFile) => [...perFile].filter(([, v]) => v.rows.some((r) => r.signature_removed)).map(([id]) => id);

const diverged = (plan, previewHashes, hashes, perFile) =>
  plan.files
    .map((f) => f.fileId)
    .filter((id) => {
      if (!previewHashes.has(id)) return false;
      const run = perFile.get(id);
      if (!run || run.rows.some((r) => r.verdict === 'failed' || r.verdict === 'cancelled')) return false;
      return hashes.get(id) !== previewHashes.get(id);
    });

const outputsDigest = (outputs) => sha256Text(outputs.map((o) => `${o.name}\t${o.sha256}`).join('\n'));
const partsDigest = (parts) => sha256Text(parts.map((p) => `${p.name}\t${p.digest}`).join('\n'));

const stoppedResult = (out) => (out && out.stopped && out.files.length ? { cancelled: true, written: out.files.length, into: out.name } : { cancelled: true });

export function startPlanRun({ session, pool, recipe, now, runId, mode, preview = null, confirmSignatures = false, loadAlignText = null, onProgress = () => {}, build = null }) {
  if (!previewSupport(recipe).ok) throw new Error(`${recipe.recipe} cannot be previewed yet`);
  if (mode !== 'preview' && mode !== 'run') throw new Error('mode must be preview or run');
  if (mode === 'run' && !preview) throw new Error('a run needs the preview it was planned from');

  const indexes = indexesOf(session);
  const frozenNow = mode === 'run' ? preview.now : now;
  const plan = resolvePlan(recipe, indexes, { now: frozenNow });
  let cancelled = false;
  const refuse = (code, extra = {}) => ({ ok: false, code, ...extra });

  const early = () => {
    if (plan.errors.length) return refuse('plan.invalid', { errors: plan.errors, plan });
    if (mode === 'run' && JSON.stringify(plan) !== JSON.stringify(preview.plan)) return refuse('plan.stale');
    const signed = mode === 'run' ? signedFiles(preview.perFile) : [];
    if (signed.length && !confirmSignatures) return refuse('vba.confirmNeeded', { count: signed.length });
    return null;
  };
  const refused = early();
  if (refused) return { promise: Promise.resolve(refused), cancel() {} };

  const jobs = plan.files.filter((f) => f.units.length > 0);
  if (mode === 'preview') session.beginPreview();
  else session.beginRun(jobs.length);

  const promise = (async () => {
    let alignText;
    if (recipe.recipe === 'align') {
      const source = alignSourceFor(recipe.align, indexes);
      try {
        if (!loadAlignText || !source) throw new Error('align.unreadable');
        alignText = await loadAlignText({ kind: recipe.align.target, name: recipe.align.name }, { hash: recipe.align.hash, files: [{ fileId: source.fileId }] });
      } catch {
        session.abort();
        return refuse('align.unreadable');
      }
      if (cancelled) return { cancelled: true };
    }

    const options = { now: frozenNow, dryRun: mode === 'preview', limits: recipe.more.limits, culture: recipe.more.culture, runId, recipe, acknowledgeSignature: true, includeTexts: mode === 'preview', ...(alignText === undefined ? {} : { alignText }) };
    const perFile = new Map();
    let finished = 0;

    const runOne = async (filePlan) => {
      const rec = session.file(filePlan.fileId);
      const meta = { id: rec.id, name: rec.name, relPath: rec.relPath, size: rec.size };
      const fileRef = { ...meta, lastModified: rec.lastModified, file: rec.file };
      const reply = await pool.submit({ message: applyMessage(fileRef, filePlan, options), estimate: inflatedEstimate(rec) });
      const fail = (code) => failedResult(filePlan, code, { recipe, meta, runId });
      let result = null;
      if (reply.status === 'done' && reply.message.type === 'applied') result = reply.message.result;
      else if (reply.status === 'done') result = fail(reply.message.code);
      else if (reply.status === 'failed') result = fail('pool.failed');
      if (result) {
        const outputs = Array.isArray(result.outputs) ? result.outputs : [];
        const parts = Array.isArray(result.sheetParts) ? result.sheetParts : [];
        const sha256 = outputs.length ? await outputsDigest(outputs) : parts.length ? await partsDigest(parts) : result.sha256;
        perFile.set(filePlan.fileId, { rows: result.rows, changes: result.changes, warnings: result.warnings, sha256, bytes: mode === 'run' ? result.bytes : null, outputs: mode === 'run' ? outputs : outputs.map(({ bytes, ...rest }) => rest), sheetParts: parts });
        if (mode === 'run') {
          const failed = result.rows.find((r) => r.verdict === 'failed');
          if (failed) session.markFailed(filePlan.fileId, failed.reason_code);
        }
      }
      finished++;
      if (cancelled) return;
      if (mode === 'run' && session.state === 'running') session.setProgress(finished);
      onProgress(finished, jobs.length);
    };

    await Promise.all(jobs.map(runOne));
    if (cancelled) return { cancelled: true };

    let hashes = new Map([...perFile].filter(([, v]) => typeof v.sha256 === 'string').map(([id, v]) => [id, v.sha256]));
    const split = mode === 'run' ? diverged(plan, preview.hashes, hashes, perFile) : [];
    for (const id of split) {
      const held = perFile.get(id);
      perFile.set(id, { ...held, bytes: null, sha256: null, outputs: [], sheetParts: [], rows: held.rows.map((r) => ({ ...r, verdict: 'not-released', reason_code: 'verify.planDrift', verified: false, output: '' })) });
      session.markFailed(id, 'verify.planDrift');
    }
    if (split.length) hashes = new Map([...hashes].filter(([id]) => !split.includes(id)));
    let combined = null;
    if (recipe.recipe === 'transform' && recipe.output.mode === 'combined') {
      const ids = plan.files.map((f) => f.fileId).filter((id) => perFile.has(id) && perFile.get(id).sheetParts.length);
      const inputs = ids.map((id) => ({ rows: perFile.get(id).rows, sheetParts: perFile.get(id).sheetParts }));
      let settled;
      if (mode === 'run') {
        const made = await combineOutputs(inputs, { now: zipClock(frozenNow) });
        settled = made.results;
        if (made.bytes) combined = { name: made.name, bytes: made.bytes, sha256: made.sha256, sheetNames: made.sheetNames };
      } else {
        settled = labelCombined(inputs);
      }
      ids.forEach((id, i) => perFile.set(id, { ...perFile.get(id), rows: settled[i].rows, sheetParts: [] }));
    }
    const rows = reportRows(plan, indexes, new Map([...perFile].map(([id, v]) => [id, { rows: v.rows }])), runId);
    const result = { ok: true, mode, plan, now: frozenNow, runId, indexes, perFile, hashes, rows, counts: countRows(rows), signedCount: signedFiles(perFile).length, defect: split.length > 0, diverged: split, combined };

    if (mode === 'preview') {
      session.endPreview();
      return result;
    }
    if (build) {
      const out = await build(result, { shouldStop: () => cancelled });
      if (cancelled) return stoppedResult(out);
      if (!out || out.ok === false) {
        session.abort();
        return refuse(out && out.code ? out.code : 'output.failed');
      }
      session.finishRun();
      return { ...result, output: out };
    }
    session.finishRun();
    return result;
  })();

  return {
    promise: promise.then((r) => (cancelled ? (r && r.cancelled ? r : { cancelled: true }) : r)),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      pool.cancel('all');
      session.abort();
    }
  };
}
