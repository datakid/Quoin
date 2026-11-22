import { openWorkbook } from '../../core/workbook.js';
import { QuoinError } from '../../core/errors.js';
import { DEFAULT_LIMITS } from '../../core/limits.js';
import { executeFilePlan } from './collect.js';
import { executeFile, failedResult } from './index.js';

const WRITE_KINDS = ['inject', 'replace', 'align'];
const FALLBACK_TIMEOUT_MS = 30000;

function deadlineFor(limits) {
  const ms = limits && Number.isFinite(limits.timeoutMs) ? limits.timeoutMs : FALLBACK_TIMEOUT_MS;
  const end = performance.now() + ms;
  return () => performance.now() > end;
}

export async function runFilePlan(bytes, meta, filePlan, options) {
  const recipe = options.recipe;
  if (!recipe || recipe.recipe === 'collect') return executeFilePlan(bytes, meta, filePlan, options);
  if (!WRITE_KINDS.includes(recipe.recipe)) throw new Error(`${recipe.recipe} is not wired yet`);
  const runId = typeof options.runId === 'string' ? options.runId : '';
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : deadlineFor(options.limits);
  const fail = (code) => failedResult(filePlan, code, { recipe, meta, runId });
  let wb;
  try {
    wb = await openWorkbook(bytes, meta.name, DEFAULT_LIMITS);
  } catch (e) {
    if (e instanceof QuoinError) return fail(e.code);
    throw e;
  }
  try {
    return await executeFile(wb, filePlan, { now: options.now, recipe, meta, runId, acknowledgeSignature: options.acknowledgeSignature === true, alignText: options.alignText, shouldStop });
  } catch (e) {
    return fail(e && typeof e.code === 'string' ? e.code : 'internal');
  }
}
