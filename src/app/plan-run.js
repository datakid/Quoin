import { applyMessage } from '../batch/protocol.js';
import { resolvePlan, alignSourceFor } from '../batch/resolve/resolve.js';
import { failedResult } from '../batch/execute/index.js';
import { reportRows } from './outputs.js';
import { indexesOf } from './set-indexes.js';

const WRITE_RECIPES = ['inject', 'replace', 'align'];
const VERDICTS = ['changed', 'unchanged', 'skipped', 'refused', 'failed', 'cancelled'];

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

export function startPlanRun({ session, pool, recipe, now, runId, mode, preview = null, confirmSignatures = false, loadAlignText = null, onProgress = () => {}, build = null }) {
  if (!WRITE_RECIPES.includes(recipe.recipe)) throw new Error(`${recipe.recipe} cannot be previewed yet`);
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

    const options = { now: frozenNow, dryRun: mode === 'preview', limits: recipe.more.limits, culture: recipe.more.culture, runId, recipe, acknowledgeSignature: true, ...(alignText === undefined ? {} : { alignText }) };
    const perFile = new Map();
    let finished = 0;

    const runOne = async (filePlan) => {
      const rec = session.file(filePlan.fileId);
      const meta = { id: rec.id, name: rec.name, relPath: rec.relPath, size: rec.size };
      const fileRef = { ...meta, lastModified: rec.lastModified, file: rec.file };
      const reply = await pool.submit({ message: applyMessage(fileRef, filePlan, options), estimate: rec.size });
      const fail = (code) => failedResult(filePlan, code, { recipe, meta, runId });
      let result = null;
      if (reply.status === 'done' && reply.message.type === 'applied') result = reply.message.result;
      else if (reply.status === 'done') result = fail(reply.message.code);
      else if (reply.status === 'failed') result = fail('pool.failed');
      if (result) {
        perFile.set(filePlan.fileId, { rows: result.rows, changes: result.changes, warnings: result.warnings, sha256: result.sha256, bytes: mode === 'run' ? result.bytes : null });
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

    const hashes = new Map([...perFile].filter(([, v]) => typeof v.sha256 === 'string').map(([id, v]) => [id, v.sha256]));
    const rows = reportRows(plan, indexes, new Map([...perFile].map(([id, v]) => [id, { rows: v.rows }])), runId);
    const result = { ok: true, mode, plan, now: frozenNow, runId, indexes, perFile, hashes, rows, counts: countRows(rows), signedCount: signedFiles(perFile).length };

    if (mode === 'preview') {
      session.endPreview();
      return result;
    }
    const split = diverged(plan, preview.hashes, hashes, perFile);
    if (split.length) {
      session.abort();
      return refuse('plan.diverged', { files: split });
    }
    if (build) {
      const out = await build(result);
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
    promise: promise.then((r) => (cancelled ? { cancelled: true } : r)),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      pool.cancel('all');
      session.abort();
    }
  };
}
