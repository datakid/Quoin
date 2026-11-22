import { applyMessage } from '../batch/protocol.js';
import { parseRecipe } from '../batch/recipe/recipe.js';
import { resolvePlan } from '../batch/resolve/resolve.js';
import { failedResult } from '../batch/execute/collect.js';
import { buildCollectOutput } from './outputs.js';
import { indexesOf } from './set-indexes.js';

export function startCollect({ session, pool, now, runId, ceilingBytes }) {
  const recipe = parseRecipe(JSON.stringify({ recipe: 'collect', v: 1 })).recipe;
  const indexes = indexesOf(session);
  const plan = resolvePlan(recipe, indexes, { now });
  const jobs = plan.files.filter((f) => f.units.length > 0);
  session.beginRun(jobs.length);
  let cancelled = false;
  let finished = 0;
  const results = new Map();
  const options = { now, dryRun: false, limits: recipe.more.limits, culture: recipe.more.culture, runId };

  const runOne = async (filePlan) => {
    const rec = session.file(filePlan.fileId);
    const meta = { id: rec.id, name: rec.name, relPath: rec.relPath, size: rec.size };
    const fileRef = { ...meta, lastModified: rec.lastModified, file: rec.file };
    const reply = await pool.submit({ message: applyMessage(fileRef, filePlan, options), estimate: rec.size });
    let result = null;
    if (reply.status === 'done' && reply.message.type === 'applied') result = reply.message.result;
    else if (reply.status === 'done') result = failedResult(meta, filePlan, { code: reply.message.code }, options);
    else if (reply.status === 'failed') result = failedResult(meta, filePlan, { code: 'pool.failed' }, options);
    if (result) {
      results.set(filePlan.fileId, result);
      const failed = result.rows.find((r) => r.verdict === 'failed');
      if (failed) session.markFailed(filePlan.fileId, failed.reason_code);
    }
    finished++;
    if (!cancelled && session.state === 'running') session.setProgress(finished);
  };

  const promise = (async () => {
    await Promise.all(jobs.map(runOne));
    if (cancelled) return { cancelled: true };
    const out = await buildCollectOutput({ plan, indexes, results, now, runId, ...(ceilingBytes === undefined ? {} : { ceilingBytes }) });
    if (!out.ok) {
      session.abort();
      return { ok: false, code: out.code };
    }
    session.finishRun();
    return out;
  })();

  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      pool.cancel('all');
      session.abort();
    }
  };
}
