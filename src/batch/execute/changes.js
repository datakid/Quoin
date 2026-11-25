import { normalizeQueryText, toViewText } from '../../core/pq/section.js';
import { QuoinError } from '../../core/errors.js';
import { emptyChangeSet } from '../../core/save.js';
import { joinModuleSource, splitLines, splitModuleSource } from '../../core/vba/module-source.js';
import { moduleNameProblem, moduleRemovalProblem, newModuleText } from '../../core/vba/writeback.js';
import { validateModuleText } from '../../core/vba/validate.js';
import { replaceInText } from './replace.js';
import { queryNameProblem, queryRemovalProblem, queryRenameProblem } from '../../core/pq/members.js';
import { sha256Text } from '../index/hash.js';
import { REPORT_COLUMNS } from './collect.js';

export const sheetOutput = (file, sheet) => `${file} [${sheet}]`;

export function splitSheetOutput(output) {
  const m = /^(.*) \[([^\]]*)\]$/.exec(output || '');
  return m ? { file: m[1], sheet: m[2] } : null;
}

export function reportRow(meta, action, recipe, values) {
  const base = {
    run_id: '',
    file: meta.name,
    folder: meta.relPath.slice(0, meta.relPath.length - meta.name.length),
    unit: action.unit ? action.unit.name : '',
    unit_index: action.unit ? action.unit.index : 0,
    recipe: recipe.recipe,
    action: action.op,
    compute: action.compute || '',
    verdict: 'unchanged',
    reason_code: '',
    reason: '',
    old_hash: '',
    new_hash: '',
    output: '',
    verified: false,
    signature_removed: false,
    duration_ms: 0
  };
  const merged = { ...base, ...values };
  return Object.fromEntries(REPORT_COLUMNS.map((k) => [k, merged[k]]));
}

const withTexts = (change, before, after) => ({ ...change, texts: { before, after } });

const skipped = (code) => ({ verdict: 'skipped', reason_code: code, old_hash: '', new_hash: '', change: null });
const refused = (code, oldHash = '', newHash = '') => ({ verdict: 'refused', reason_code: code, old_hash: oldHash, new_hash: newHash, change: null });

async function renameQuery(wb, action, recipe, changeSet) {
  const name = action.target.name;
  const to = recipe.inject.newName;
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return skipped('skip.notApplicable');
  const hash = await sha256Text(normalizeQueryText(query.original));
  if (name === to) return { verdict: 'unchanged', reason_code: '', old_hash: hash, new_hash: hash, change: null };
  if (queryNameProblem(to)) return refused('refused.name', hash, hash);
  const taken = wb.mashup.split.members.find((m) => m.name !== name && m.name.toLowerCase() === to.toLowerCase());
  if (taken) return refused('refused.exists', hash, hash);
  const problem = queryRenameProblem(wb, name);
  if (problem) return { ...refused(problem.code, hash, hash), reason: problem.detail };
  changeSet.queries.rename.set(name, to);
  return { verdict: 'changed', reason_code: '', old_hash: hash, new_hash: hash, change: { op: 'rename', target: { type: 'query', name }, newName: to, oldHash: hash, newHash: hash } };
}

async function removeQuery(wb, action, changeSet) {
  const name = action.target.name;
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return skipped('skip.notApplicable');
  const oldHash = await sha256Text(normalizeQueryText(query.original));
  const problem = queryRemovalProblem(wb, name);
  if (problem) return { ...refused(problem.code, oldHash), reason: problem.detail };
  changeSet.queries.remove.add(name);
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: '', change: withTexts({ op: 'remove', target: { type: 'query', name }, oldHash, newHash: null }, normalizeQueryText(query.original), '') };
}

async function addQuery(wb, action, recipe, changeSet) {
  const name = action.target.name;
  if (!wb.mashup) return refused('pq.none');
  if (wb.mashup.error) return refused('pq.format');
  const text = toViewText(normalizeQueryText(recipe.inject.text));
  const newHash = await sha256Text(text);
  if (queryNameProblem(name)) return refused('refused.name', '', newHash);
  const taken = wb.mashup.split.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (taken) {
    const existing = wb.queries.find((q) => q.name === taken.name);
    return refused('refused.exists', existing ? await sha256Text(normalizeQueryText(existing.original)) : '', newHash);
  }
  changeSet.queries.add.set(name, text);
  const outcome = { verdict: 'changed', reason_code: '', old_hash: '', new_hash: newHash, change: withTexts({ op: 'add', target: { type: 'query', name }, oldHash: null, newHash }, '', text) };
  return recipe.inject.refreshOnLoad === true ? { ...outcome, warning: { code: 'refresh.notApplied', part: name } } : outcome;
}

async function stageQuery(query, text, changeSet) {
  const oldHash = await sha256Text(normalizeQueryText(query.original));
  const newHash = await sha256Text(text);
  if (oldHash === newHash) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: newHash, change: null };
  changeSet.queries.replace.set(query.name, text);
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: withTexts({ op: 'replace', target: { type: 'query', name: query.name }, oldHash, newHash }, normalizeQueryText(query.original), text) };
}

async function replaceQuery(wb, action, recipe, changeSet) {
  const name = action.target.name;
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return skipped('skip.notApplicable');
  const outcome = await stageQuery(query, toViewText(normalizeQueryText(recipe.inject.text)), changeSet);
  if (outcome.change && recipe.inject.refreshOnLoad === true) {
    if (query.connection) changeSet.refreshOnLoad.add(name);
    else return { ...outcome, warning: { code: 'refresh.notApplied', part: name } };
  }
  return outcome;
}

function moduleTarget(wb, name) {
  if (!wb.vba) return { outcome: skipped('skip.notApplicable') };
  if (wb.vba.error) return { outcome: refused(wb.vba.error) };
  const project = wb.vba.project;
  if (!project) return { outcome: refused('vba.unreadable') };
  const mod = project.modules.find((m) => m.name === name);
  if (!mod) return { outcome: skipped('skip.notApplicable') };
  if (!mod.model) return { outcome: refused('vba.unreadable') };
  return { project, mod };
}

const notWritable = (project, oldHash, newHash) => (project.writable ? null : refused(project.locked ? 'vba.locked' : 'vba.write', oldHash, newHash));
const notAcknowledged = (wb, acknowledgeSignature, oldHash, newHash) => (wb.vba.signed && !acknowledgeSignature ? refused('vba.signature', oldHash, newHash) : null);

function invalidText(project, text, originalBytes, oldHash, newHash) {
  const problems = validateModuleText({ text, codePage: project.codePage, originalBytes });
  return problems.length ? { ...refused(problems[0].code, oldHash, newHash), reason: `${problems[0].line}:${problems[0].col}` } : null;
}

function projectOf(wb) {
  if (!wb.vba) return { outcome: refused('refused.noMacros') };
  if (wb.vba.error) return { outcome: refused(wb.vba.error) };
  if (!wb.vba.project) return { outcome: refused('vba.unreadable') };
  return { project: wb.vba.project };
}

async function stageModule(wb, project, mod, text, changeSet, acknowledgeSignature) {
  const oldHash = await sha256Text(mod.text);
  if (text === mod.model.visible) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: oldHash, change: null };
  const newHash = await sha256Text(joinModuleSource(mod.model, text));
  const blocked = notWritable(project, oldHash, newHash) || invalidText(project, text, mod.sourceBytes, oldHash, newHash) || notAcknowledged(wb, acknowledgeSignature, oldHash, newHash);
  if (blocked) return blocked;
  changeSet.modules.replace.set(mod.name, text);
  if (wb.vba.signed) changeSet.acknowledgeSignature = true;
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: withTexts({ op: 'replace', target: { type: 'module', name: mod.name }, oldHash, newHash }, mod.model.visible, text) };
}

async function replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }) {
  const found = moduleTarget(wb, action.target.name);
  if (found.outcome) return found.outcome;
  return stageModule(wb, found.project, found.mod, splitLines(recipe.inject.text).join('\n'), changeSet, acknowledgeSignature);
}

async function addModule(wb, action, recipe, changeSet, { acknowledgeSignature }) {
  const name = action.target.name;
  const found = projectOf(wb);
  if (found.outcome) return found.outcome;
  const { project } = found;
  const problem = moduleNameProblem(project, name);
  if (problem) return refused(problem === 'exists' ? 'refused.exists' : 'refused.name');
  const joined = splitLines(recipe.inject.text).join('\n');
  const text = joined.endsWith('\n') ? joined : `${joined}\n`;
  const newHash = await sha256Text(newModuleText(name, text));
  const blocked = notWritable(project, '', newHash) || invalidText(project, text, undefined, '', newHash) || notAcknowledged(wb, acknowledgeSignature, '', newHash);
  if (blocked) return blocked;
  changeSet.modules.add.set(name, text);
  if (wb.vba.signed) changeSet.acknowledgeSignature = true;
  return { verdict: 'changed', reason_code: '', old_hash: '', new_hash: newHash, change: withTexts({ op: 'add', target: { type: 'module', name }, oldHash: null, newHash }, '', text) };
}

async function removeModule(wb, action, changeSet, { acknowledgeSignature }) {
  const name = action.target.name;
  const found = moduleTarget(wb, name);
  if (found.outcome) return found.outcome;
  const { project, mod } = found;
  const oldHash = await sha256Text(mod.text);
  const kind = moduleRemovalProblem(project, name);
  if (kind) return { ...refused('refused.moduleKind', oldHash), reason: kind };
  const blocked = notWritable(project, oldHash, '') || notAcknowledged(wb, acknowledgeSignature, oldHash, '');
  if (blocked) return blocked;
  changeSet.modules.remove.add(name);
  if (wb.vba.signed) changeSet.acknowledgeSignature = true;
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: '', change: withTexts({ op: 'remove', target: { type: 'module', name }, oldHash, newHash: null }, mod.model.visible, '') };
}

const CODE_KIND = { query: 'm', module: 'vba' };

function withMatches(outcome, found) {
  if (!outcome.change) return outcome;
  return { ...outcome, change: { ...outcome.change, op: 'replaceText', matchCount: found.count, matches: found.matches.map(({ line, col, before, after }) => ({ line, col, before, after })) } };
}

async function replaceText(wb, action, recipe, changeSet, { acknowledgeSignature, shouldStop }) {
  const { type, name } = action.target;
  const spec = recipe.replace;
  if (!spec.in.includes(CODE_KIND[type])) return skipped('skip.notApplicable');
  if (type === 'query') {
    const query = wb.queries.find((x) => x.name === name);
    if (!query) return skipped('skip.notApplicable');
    const found = replaceInText(normalizeQueryText(query.original), spec, shouldStop);
    return withMatches(await stageQuery(query, toViewText(normalizeQueryText(found.text)), changeSet), found);
  }
  const target = moduleTarget(wb, name);
  if (target.outcome) return target.outcome;
  const found = replaceInText(target.mod.model.visible, spec, shouldStop);
  return withMatches(await stageModule(wb, target.project, target.mod, splitLines(found.text).join('\n'), changeSet, acknowledgeSignature), found);
}

async function alignSource(spec, alignText) {
  if (typeof alignText !== 'string') throw new Error('an align recipe needs alignText');
  if (spec.target === 'query') {
    const text = toViewText(normalizeQueryText(alignText));
    return { ok: (await sha256Text(text)) === spec.hash, text };
  }
  return { ok: (await sha256Text(alignText)) === spec.hash, text: splitModuleSource(alignText).visible };
}

const asAlign = (outcome) => (outcome.change ? { ...outcome, change: { ...outcome.change, op: 'align' } } : outcome);

async function alignTarget(wb, action, recipe, changeSet, source, { acknowledgeSignature }) {
  const { type, name } = action.target;
  if (type !== recipe.align.target) return skipped('skip.notApplicable');
  if (type === 'query') {
    const query = wb.queries.find((x) => x.name === name);
    if (!query) return skipped('skip.notApplicable');
    if (!source.ok) return { verdict: 'failed', reason_code: 'align.sourceChanged', old_hash: '', new_hash: '', change: null };
    return asAlign(await stageQuery(query, source.text, changeSet));
  }
  const target = moduleTarget(wb, name);
  if (target.outcome) return target.outcome;
  if (!source.ok) return { verdict: 'failed', reason_code: 'align.sourceChanged', old_hash: '', new_hash: '', change: null };
  return asAlign(await stageModule(wb, target.project, target.mod, source.text, changeSet, acknowledgeSignature));
}

export async function planChanges(wb, filePlan, recipe, { acknowledgeSignature = false, alignText, shouldStop = () => false } = {}) {
  const changeSet = emptyChangeSet();
  const outcomes = [];
  const source = recipe.recipe === 'align' ? await alignSource(recipe.align, alignText) : null;
  const claimed = new Set();
  for (const action of filePlan.actions) {
    if (shouldStop()) throw new QuoinError('m.timeout', 'the deadline passed before the next target');
    const claim = `${action.target.type}|${action.target.name}`;
    if (claimed.has(claim)) {
      outcomes.push(refused('refused.duplicate'));
      continue;
    }
    claimed.add(claim);
    if (action.op === 'replace' && action.target.type === 'query') outcomes.push(await replaceQuery(wb, action, recipe, changeSet));
    else if (action.op === 'replace' && action.target.type === 'module') outcomes.push(await replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }));
    else if (action.op === 'replaceText' && (action.target.type === 'query' || action.target.type === 'module')) outcomes.push(await replaceText(wb, action, recipe, changeSet, { acknowledgeSignature, shouldStop }));
    else if (action.op === 'align') outcomes.push(await alignTarget(wb, action, recipe, changeSet, source, { acknowledgeSignature }));
    else if (action.op === 'rename' && action.target.type === 'module') outcomes.push(refused('refused.unsupported'));
    else if (action.op === 'add' && action.target.type === 'module') outcomes.push(await addModule(wb, action, recipe, changeSet, { acknowledgeSignature }));
    else if (action.op === 'remove' && action.target.type === 'module') outcomes.push(await removeModule(wb, action, changeSet, { acknowledgeSignature }));
    else if (action.op === 'add' && action.target.type === 'query') outcomes.push(await addQuery(wb, action, recipe, changeSet));
    else if (action.op === 'remove' && action.target.type === 'query') outcomes.push(await removeQuery(wb, action, changeSet));
    else if (action.op === 'rename' && action.target.type === 'query') outcomes.push(await renameQuery(wb, action, recipe, changeSet));
    else throw new Error(`${action.op} ${action.target.type} is not supported yet`);
  }
  return { changeSet, outcomes };
}
