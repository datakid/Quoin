import { normalizeQueryText, toViewText } from '../../core/pq/section.js';
import { emptyChangeSet } from '../../core/save.js';
import { splitLines } from '../../core/vba/module-source.js';
import { validateModuleText } from '../../core/vba/validate.js';
import { replaceInText } from './replace.js';
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

async function stageQuery(query, text, changeSet) {
  const oldHash = await sha256Text(normalizeQueryText(query.original));
  const newHash = await sha256Text(text);
  if (oldHash === newHash) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: newHash, change: null };
  changeSet.queries.replace.set(query.name, text);
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: { op: 'replace', target: { type: 'query', name: query.name }, oldHash, newHash } };
}

async function replaceQuery(wb, action, recipe, changeSet) {
  const name = action.target.name;
  const query = wb.queries.find((x) => x.name === name);
  if (!query) return skipped('skip.notApplicable');
  const outcome = await stageQuery(query, toViewText(normalizeQueryText(recipe.inject.text)), changeSet);
  if (outcome.change && recipe.inject.refreshOnLoad === true) changeSet.refreshOnLoad.add(name);
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

async function stageModule(wb, project, mod, text, changeSet, acknowledgeSignature) {
  const oldHash = await sha256Text(mod.model.visible);
  const newHash = await sha256Text(text);
  if (oldHash === newHash) return { verdict: 'unchanged', reason_code: '', old_hash: oldHash, new_hash: newHash, change: null };
  if (!project.writable) return refused(project.locked ? 'vba.locked' : 'vba.write', oldHash, newHash);
  const problems = validateModuleText({ text, codePage: project.codePage, originalBytes: mod.sourceBytes });
  if (problems.length) return { ...refused(problems[0].code, oldHash, newHash), reason: `${problems[0].line}:${problems[0].col}` };
  if (wb.vba.signed && !acknowledgeSignature) return refused('vba.signature', oldHash, newHash);
  changeSet.modules.replace.set(mod.name, text);
  if (wb.vba.signed) changeSet.acknowledgeSignature = true;
  return { verdict: 'changed', reason_code: '', old_hash: oldHash, new_hash: newHash, change: { op: 'replace', target: { type: 'module', name: mod.name }, oldHash, newHash } };
}

async function replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }) {
  const found = moduleTarget(wb, action.target.name);
  if (found.outcome) return found.outcome;
  return stageModule(wb, found.project, found.mod, splitLines(recipe.inject.text).join('\n'), changeSet, acknowledgeSignature);
}

const CODE_KIND = { query: 'm', module: 'vba' };

function withMatches(outcome, found) {
  if (!outcome.change) return outcome;
  return { ...outcome, change: { ...outcome.change, op: 'replaceText', matchCount: found.count, matches: found.matches.map(({ line, col, before, after }) => ({ line, col, before, after })) } };
}

async function replaceText(wb, action, recipe, changeSet, { acknowledgeSignature }) {
  const { type, name } = action.target;
  const spec = recipe.replace;
  if (!spec.in.includes(CODE_KIND[type])) return skipped('skip.notApplicable');
  if (type === 'query') {
    const query = wb.queries.find((x) => x.name === name);
    if (!query) return skipped('skip.notApplicable');
    const found = replaceInText(normalizeQueryText(query.original), spec);
    return withMatches(await stageQuery(query, toViewText(normalizeQueryText(found.text)), changeSet), found);
  }
  const target = moduleTarget(wb, name);
  if (target.outcome) return target.outcome;
  const found = replaceInText(target.mod.model.visible, spec);
  return withMatches(await stageModule(wb, target.project, target.mod, splitLines(found.text).join('\n'), changeSet, acknowledgeSignature), found);
}

export async function planChanges(wb, filePlan, recipe, { acknowledgeSignature = false } = {}) {
  const changeSet = emptyChangeSet();
  const outcomes = [];
  for (const action of filePlan.actions) {
    if (action.op === 'replace' && action.target.type === 'query') outcomes.push(await replaceQuery(wb, action, recipe, changeSet));
    else if (action.op === 'replace' && action.target.type === 'module') outcomes.push(await replaceModule(wb, action, recipe, changeSet, { acknowledgeSignature }));
    else if (action.op === 'replaceText' && (action.target.type === 'query' || action.target.type === 'module')) outcomes.push(await replaceText(wb, action, recipe, changeSet, { acknowledgeSignature }));
    else if (action.op === 'add' && action.target.type === 'query') outcomes.push(await addQuery(wb, action, recipe, changeSet));
    else if (action.op === 'remove' && action.target.type === 'query') outcomes.push(await removeQuery(wb, action, changeSet));
    else if (action.op === 'rename' && action.target.type === 'query') outcomes.push(await renameQuery(wb, action, recipe, changeSet));
    else throw new Error(`${action.op} ${action.target.type} is not supported yet`);
  }
  return { changeSet, outcomes };
}
