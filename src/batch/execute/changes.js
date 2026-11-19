import { normalizeQueryText, toViewText } from '../../core/pq/section.js';
import { emptyChangeSet } from '../../core/save.js';
import { splitLines } from '../../core/vba/module-source.js';
import { validateModuleText } from '../../core/vba/validate.js';
import { queryNameProblem, queryRemovalProblem, queryRenameProblem } from '../../core/pq/members.js';
import { sha256Text } from '../index/hash.js';
import { REPORT_COLUMNS } from './collect.js';

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

const skipped = (code) => ({ verdict: 'skipped', reason_code: code, old_hash: '', new_hash: '', change: null });
const refused = (code, oldHash = '', newHash = '') => ({ verdict: 'refused', reason_code: code, old_hash: oldHash, new_hash: newHash, change: null });

async function replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }) {
  const name = action.target.name;
  if (!wb.vba) return skipped('skip.notApplicable');
  if (wb.vba.error) return refused(wb.vba.error);
  const project = wb.vba.project;
  if (!project) return refused('vba.unreadable');
  const mod = project.modules.find((m) => m.name === name);
  if (!mod) return skipped('skip.notApplicable');
  if (!mod.model) return refused('vba.unreadable');
  const text = splitLines(recipe.inject.text).join('\n');
  const oldHash = await sha256Text(mod.model.visible);
  const newHash = await sha256Text(text);
  if (oldHash === newHash) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: newHash, change: null };
  if (!project.writable) return refused(project.locked ? 'vba.locked' : 'vba.write', oldHash, newHash);
  const problems = validateModuleText({ text, codePage: project.codePage, originalBytes: mod.sourceBytes });
  if (problems.length) return { ...refused(problems[0].code, oldHash, newHash), reason: `${problems[0].line}:${problems[0].col}` };
  if (wb.vba.signed && !acknowledgeSignature) return refused('vba.signature', oldHash, newHash);
  changeSet.modules.replace.set(name, text);
  if (wb.vba.signed) changeSet.acknowledgeSignature = true;
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: { op: 'replace', target: { type: 'module', name }, oldHash, newHash } };
}

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
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: '', change: { op: 'remove', target: { type: 'query', name }, oldHash, newHash: null } };
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
  return { verdict: 'changed', reason_code: '', old_hash: '', new_hash: newHash, change: { op: 'add', target: { type: 'query', name }, oldHash: null, newHash } };
}

async function replaceQuery(wb, action, recipe, changeSet) {
  const name = action.target.name;
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return skipped('skip.notApplicable');
  const text = toViewText(normalizeQueryText(recipe.inject.text));
  const oldHash = await sha256Text(normalizeQueryText(query.original));
  const newHash = await sha256Text(text);
  if (oldHash === newHash) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: newHash, change: null };
  changeSet.queries.replace.set(name, text);
  if (recipe.inject.refreshOnLoad === true) changeSet.refreshOnLoad.add(name);
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: { op: 'replace', target: { type: 'query', name }, oldHash, newHash } };
}

export async function planChanges(wb, filePlan, recipe, { acknowledgeSignature = false } = {}) {
  const changeSet = emptyChangeSet();
  const outcomes = [];
  for (const action of filePlan.actions) {
    if (action.op === 'replace' && action.target.type === 'query') outcomes.push(await replaceQuery(wb, action, recipe, changeSet));
    else if (action.op === 'replace' && action.target.type === 'module') outcomes.push(await replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }));
    else if (action.op === 'add' && action.target.type === 'query') outcomes.push(await addQuery(wb, action, recipe, changeSet));
    else if (action.op === 'remove' && action.target.type === 'query') outcomes.push(await removeQuery(wb, action, changeSet));
    else if (action.op === 'rename' && action.target.type === 'query') outcomes.push(await renameQuery(wb, action, recipe, changeSet));
    else throw new Error(`${action.op} ${action.target.type} is not supported yet`);
  }
  return { changeSet, outcomes };
}
