import { normalizeQueryText, toViewText } from '../../core/pq/section.js';
import { emptyChangeSet } from '../../core/save.js';
import { queryNameProblem, queryRemovalProblem } from '../../core/pq/members.js';
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

export async function planChanges(wb, filePlan, recipe) {
  const changeSet = emptyChangeSet();
  const outcomes = [];
  for (const action of filePlan.actions) {
    if (action.op === 'replace' && action.target.type === 'query') outcomes.push(await replaceQuery(wb, action, recipe, changeSet));
    else if (action.op === 'add' && action.target.type === 'query') outcomes.push(await addQuery(wb, action, recipe, changeSet));
    else if (action.op === 'remove' && action.target.type === 'query') outcomes.push(await removeQuery(wb, action, changeSet));
    else throw new Error(`${action.op} ${action.target.type} is not supported yet`);
  }
  return { changeSet, outcomes };
}
