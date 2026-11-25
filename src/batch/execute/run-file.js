import { openWorkbook } from '../../core/workbook.js';
import { QuoinError } from '../../core/errors.js';
import { DEFAULT_LIMITS } from '../../core/limits.js';
import { executeFilePlan } from './collect.js';
import { executeFile, failedResult } from './index.js';

const WRITE_KINDS = ['inject', 'replace', 'align', 'transform'];
const FALLBACK_TIMEOUT_MS = 30000;

function deadlineFor(limits) {
  const ms = limits && Number.isFinite(limits.timeoutMs) ? limits.timeoutMs : FALLBACK_TIMEOUT_MS;
  const end = performance.now() + ms;
  return () => performance.now() > end;
}

function transformReply(result, dryRun) {
  const outputs = result.outputs.map((o) => ({ unit: o.unit, name: o.name, bytes: dryRun ? null : o.bytes, sha256: o.sha256 }));
  return { fileId: result.fileId, bytes: dryRun ? null : result.bytes, sha256: dryRun ? null : result.sha256, changes: [], warnings: result.warnings, rows: result.rows, outputs, sheetParts: dryRun ? result.sheetParts.map((part) => ({ ...part, xml: null })) : result.sheetParts };
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
    const result = await executeFile(wb, filePlan, { now: options.now, recipe, meta, runId, acknowledgeSignature: options.acknowledgeSignature === true, alignText: options.alignText, includeTexts: options.includeTexts === true, shouldStop });
    return recipe.recipe === 'transform' ? transformReply(result, options.dryRun === true) : result;
  } catch (e) {
    return fail(e && typeof e.code === 'string' ? e.code : 'internal');
  }
}
