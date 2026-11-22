import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from '../../src/core/workbook.js';
import { replaceInText, MATCH_LIST_LIMIT } from '../../src/batch/execute/replace.js';
import { executeFile, failedResult } from '../../src/batch/execute/index.js';
import { sha256Text } from '../../src/batch/index/hash.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const spec = (over = {}) => ({ find: 'x', with: 'y', kind: 'text', matchCase: true, ...over });

test('F2-08: plain text replaces every occurrence, case-sensitive by default, and lists each match', () => {
  const r = replaceInText('ab AB ab', spec({ find: 'ab', with: 'Z' }));
  assert.equal(r.text, 'Z AB Z');
  assert.equal(r.count, 2);
  assert.deepEqual(r.matches, [{ index: 0, line: 1, col: 1, before: 'ab', after: 'Z' }, { index: 6, line: 1, col: 7, before: 'ab', after: 'Z' }]);
});

test('F2-08: matchCase false matches any case, and the replacement of a plain find is literal', () => {
  const r = replaceInText('ab AB', spec({ find: 'ab', with: '$&-$1', matchCase: false }));
  assert.equal(r.text, '$&-$1 $&-$1');
});

test('F2-08: a plain find with regex characters is matched literally', () => {
  assert.equal(replaceInText('a.b aXb', spec({ find: 'a.b', with: '!' })).text, '! aXb');
  assert.equal(replaceInText('f(x) f[x]', spec({ find: '(x)', with: '()' })).text, 'f() f[x]');
});

test('F2-08: a regex uses groups and the usual replacement patterns', () => {
  const r = (text, find, to) => replaceInText(text, spec({ find, with: to, kind: 'regex' })).text;
  assert.equal(r('Table.Foo Table.Bar', 'Table\\.(\\w+)', 'T.$1'), 'T.Foo T.Bar');
  assert.equal(r('abc', 'b', '[$&]'), 'a[b]c');
  assert.equal(r('abc', 'b', '$$'), 'a$c');
  assert.equal(r('abc', 'b', '<$`|$\'>'), 'a<a|c>c');
  assert.equal(r('2026-11', '(?<y>\\d+)-(?<m>\\d+)', '$<m>/$<y>'), '11/2026');
  assert.equal(r('ab', '(a)', '$10'), 'a0b');
  assert.equal(r('ab', '(a)', '$2'), '$2b');
  assert.equal(r('ab', '(a)', '$0'), '$0b');
  assert.equal(r('ab', '(a)(b)', '$2$1'), 'ba');
});

test('F2-08: with ten or more groups $10 is the tenth group and $01 is the first', () => {
  const find = '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)';
  assert.equal(replaceInText('abcdefghij', spec({ find, with: '$10$1', kind: 'regex' })).text, 'ja');
  assert.equal(replaceInText('abcdefghij', spec({ find, with: '$01', kind: 'regex' })).text, 'a');
  assert.equal(replaceInText('abcdefghij', spec({ find, with: '$11', kind: 'regex' })).text, 'a1');
});

test('F2-08: a regex follows matchCase', () => {
  assert.equal(replaceInText('Ab ab', spec({ find: 'ab', with: '_', kind: 'regex', matchCase: false })).text, '_ _');
  assert.equal(replaceInText('Ab ab', spec({ find: 'ab', with: '_', kind: 'regex', matchCase: true })).text, 'Ab _');
});

test('F2-08: a match with no characters is never replaced', () => {
  const r = replaceInText('abxc', spec({ find: 'x*', with: '-', kind: 'regex' }));
  assert.equal(r.text, 'ab-c');
  assert.equal(r.count, 1);
  assert.equal(replaceInText('abc', spec({ find: '', with: '-' })).text, 'abc');
});

test('F2-08: line and column are one-based and point into the old text across lines', () => {
  const r = replaceInText('one\r\ntwo two\nthree', spec({ find: 'two', with: '2' }));
  assert.deepEqual(r.matches.map((m) => [m.line, m.col]), [[2, 1], [2, 5]]);
  assert.equal(r.text, 'one\r\n2 2\nthree');
});

test('F2-08: the match list is capped and each side is cut short, but the count and the text are complete', () => {
  const many = replaceInText('x'.repeat(250), spec({ find: 'x', with: 'yy' }));
  assert.equal(many.count, 250);
  assert.equal(many.matches.length, MATCH_LIST_LIMIT);
  assert.equal(many.text, 'yy'.repeat(250));
  const long = replaceInText(`${'a'.repeat(500)}`, spec({ find: 'a+', with: 'b'.repeat(400), kind: 'regex' }));
  assert.equal(long.matches[0].before.length, 200);
  assert.equal(long.matches[0].after.length, 200);
  assert.equal(long.text.length, 400);
});

test('F2-08: text with no match comes back as it was', () => {
  const r = replaceInText('hello', spec({ find: 'zzz' }));
  assert.equal(r.text, 'hello');
  assert.equal(r.count, 0);
  assert.deepEqual(r.matches, []);
});

const unit = { fileId: 'f0001', kind: 'workbook', name: 'f', index: 1 };
const planOf = (targets) => ({ fileId: 'f0001', source: 'rule', units: [unit], actions: targets.map(([type, name]) => ({ unit, op: 'replaceText', target: { type, name }, compute: null, output: null, replaces: null })), skipped: null });
const recipeOf = (over = {}) => ({ recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'StudentNames', with: 'Pupils', kind: 'text', matchCase: true, ...over } });
const openSimple = () => openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
const openMixed = () => openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
const modOf = (wb, name) => wb.vba.project.modules.find((m) => m.name === name);

test('F2-08: a text replace in a query changes it, reports the hashes and lists each match', async () => {
  const wb = await openSimple();
  const old = wb.queries[0].original;
  const res = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf() });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.equal(back.queries[0].original, old.replace('StudentNames', 'Pupils'));
  const col = old.split('\n')[1].indexOf('StudentNames') + 1;
  assert.deepEqual(res.changes, [{ op: 'replaceText', target: { type: 'query', name: 'StudentResults' }, oldHash: await sha256Text(old), newHash: await sha256Text(old.replace('StudentNames', 'Pupils')), matchCount: 1, matches: [{ line: 2, col, before: 'StudentNames', after: 'Pupils' }] }]);
  const row = res.rows[0];
  assert.equal(row.recipe, 'replace');
  assert.equal(row.action, 'replaceText');
  assert.equal(row.verdict, 'changed');
  assert.equal(row.old_hash, res.changes[0].oldHash);
  assert.equal(row.new_hash, res.changes[0].newHash);
  assert.equal(row.verified, true);
});

test('F2-08: a query with no match is unchanged and nothing is written', async () => {
  const wb = await openSimple();
  const res = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf({ find: 'nothing here' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'unchanged');
  assert.equal(res.rows[0].old_hash, res.rows[0].new_hash);
});

test('F2-08: a regex replace works on a query and a module in the same file with one write', async () => {
  const wb = await openMixed();
  const plan = planOf([['query', 'FinalTable'], ['module', 'Module1'], ['query', 'RawInput']]);
  const res = await executeFile(wb, plan, { now: NOW, recipe: recipeOf({ find: '(DateTime|MsgBox)', with: 'My$1', kind: 'regex' }) });
  const back = await openWorkbook(res.bytes, 'x.xlsm');
  assert.ok(back.queries.find((q) => q.name === 'FinalTable').original.includes('MyDateTime.LocalNow()'));
  assert.ok(modOf(back, 'Module1').model.visible.includes('MyMsgBox "Hello, World!"'));
  assert.deepEqual(res.rows.map((r) => r.verdict), ['changed', 'changed', 'unchanged']);
  assert.equal(res.changes.length, 2);
  assert.equal(back.queries.find((q) => q.name === 'RawInput').original, wb.queries.find((q) => q.name === 'RawInput').original);
});

test('F2-08: only the kinds named in the recipe are searched', async () => {
  const wb = await openMixed();
  const onlyM = await executeFile(wb, planOf([['module', 'Module1']]), { now: NOW, recipe: recipeOf({ in: ['m'], find: 'Hello', with: 'Hi' }) });
  assert.equal(onlyM.rows[0].verdict, 'skipped');
  assert.equal(onlyM.rows[0].reason_code, 'skip.notApplicable');
  const onlyVba = await executeFile(wb, planOf([['query', 'FinalTable']]), { now: NOW, recipe: recipeOf({ in: ['vba'], find: 'Raw', with: 'Rough' }) });
  assert.equal(onlyVba.rows[0].verdict, 'skipped');
  assert.ok(onlyM.bytes === null && onlyVba.bytes === null);
});

test('F2-08: a query or module the file does not have is skipped', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, planOf([['query', 'Nope'], ['module', 'Nope']]), { now: NOW, recipe: recipeOf({ find: 'a' }) });
  assert.deepEqual(res.rows.map((r) => [r.verdict, r.reason_code]), [['skipped', 'skip.notApplicable'], ['skipped', 'skip.notApplicable']]);
  const plain = await executeFile(await openSimple(), planOf([['module', 'Module1']]), { now: NOW, recipe: recipeOf({ find: 'a' }) });
  assert.equal(plain.rows[0].verdict, 'skipped');
});

test('F2-08: a replace that breaks the query makes the file fail with m.parse and writes nothing', async () => {
  const wb = await openSimple();
  const res = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf({ find: 'let', with: 'let let', kind: 'text' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'm.parse');
});

test('F2-08: a replace that a macro cannot hold is refused with the line and column', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, planOf([['module', 'Module1']]), { now: NOW, recipe: recipeOf({ find: 'Hello', with: 'Hi\u0000' }) });
  assert.ok(res.bytes === null);
  assert.equal(res.rows[0].verdict, 'refused');
  assert.equal(res.rows[0].reason_code, 'vba.nul');
  assert.equal(res.rows[0].reason, '2:15');
});

test('F2-08: a signed project is refused until acknowledged, then marked as losing its signature', async () => {
  const wb = await openWorkbook(generated('signed.xlsm'), 'signed.xlsm');
  const recipe = recipeOf({ find: 'Hello', with: 'Hi' });
  const refused = await executeFile(wb, planOf([['module', 'Module1']]), { now: NOW, recipe });
  assert.equal(refused.rows[0].reason_code, 'vba.signature');
  assert.ok(refused.bytes === null);
  const done = await executeFile(wb, planOf([['module', 'Module1']]), { now: NOW, recipe, acknowledgeSignature: true });
  assert.equal(done.rows[0].verdict, 'changed');
  assert.equal(done.rows[0].signature_removed, true);
});

test('F2-08: a find with a line break matches the single-break text a macro is shown as', async () => {
  const wb = await openMixed();
  const res = await executeFile(wb, planOf([['module', 'Module1']]), { now: NOW, recipe: recipeOf({ find: 'End Sub\n', with: 'End Sub\n\n', kind: 'text' }) });
  assert.equal(modOf(await openWorkbook(res.bytes, 'x.xlsm'), 'Module1').model.visible, 'Sub say_hello()\n    MsgBox "Hello, World!"\nEnd Sub\n\n');
});

test('F2-08: the same now gives the same bytes for a replace', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 14, 10, 0, 0) });
  const wb = await openSimple();
  const a = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf() });
  t.mock.timers.tick(30000);
  const b = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf() });
  assert.equal(a.sha256, b.sha256);
});

test('F2-08: a timed-out or crashed job can be turned into failed rows with the same shape', () => {
  const plan = planOf([['query', 'A'], ['module', 'B']]);
  const res = failedResult(plan, 'm.timeout', { recipe: recipeOf(), meta: { name: 'f.xlsx', relPath: 'east/f.xlsx' }, runId: 'r9' });
  assert.equal(res.fileId, 'f0001');
  assert.ok(res.bytes === null && res.sha256 === null);
  assert.deepEqual(res.changes, []);
  assert.deepEqual(res.rows.map((r) => [r.verdict, r.reason_code, r.verified, r.run_id, r.file, r.folder, r.action, r.recipe]), [
    ['failed', 'm.timeout', false, 'r9', 'f.xlsx', 'east/', 'replaceText', 'replace'],
    ['failed', 'm.timeout', false, 'r9', 'f.xlsx', 'east/', 'replaceText', 'replace']
  ]);
});

const workerFile = fileURLToPath(new URL('./redos-worker.mjs', import.meta.url));
const simplePath = fileURLToPath(new URL('../fixtures/external/pq_simple.xlsx', import.meta.url));

const startWorker = (data) => new Worker(workerFile, { workerData: { path: simplePath, ...data } });

async function nextOfType(worker, type) {
  for (;;) {
    const [message] = await once(worker, 'message');
    if (message.type === type) return message;
  }
}

test('F2-08: a catastrophic regex never returns, its worker can be stopped, and the next file still runs', async () => {
  const bad = startWorker({ find: '(a+)+$', text: `${'a'.repeat(45)}b` });
  const seen = [];
  bad.on('message', (m) => seen.push(m.type));
  await nextOfType(bad, 'started');
  const exited = once(bad, 'exit');
  await bad.terminate();
  await exited;
  assert.ok(!seen.includes('done'));
  const good = startWorker({ find: 'StudentNames' });
  assert.deepEqual(await nextOfType(good, 'done'), { type: 'done', verdict: 'changed', hasBytes: true });
  await good.terminate();
});

const countingStop = (limit) => {
  const state = { calls: 0 };
  state.stop = () => {
    state.calls += 1;
    return limit !== null && state.calls >= limit;
  };
  return state;
};

test('F2-08: a deadline checked between targets and between matches fails the file with m.timeout at every possible point and never writes part of it', async () => {
  const wb = await openMixed();
  const plan = planOf([['query', 'FinalTable'], ['module', 'Module1'], ['query', 'RawInput'], ['module', 'Sheet1']]);
  const recipe = recipeOf({ find: '(DateTime|MsgBox)', with: 'My$1', kind: 'regex' });
  const free = countingStop(null);
  const whole = await executeFile(wb, plan, { now: NOW, recipe, shouldStop: free.stop });
  assert.ok(whole.bytes);
  assert.ok(free.calls > 8);
  for (let n = 1; n <= free.calls; n++) {
    const state = countingStop(n);
    const res = await executeFile(wb, plan, { now: NOW, recipe, shouldStop: state.stop });
    assert.ok(res.bytes === null, `stop at check ${n}`);
    assert.ok(res.sha256 === null);
    assert.deepEqual(res.changes, []);
    assert.deepEqual(res.rows.map((r) => [r.verdict, r.reason_code, r.verified]), plan.actions.map(() => ['failed', 'm.timeout', false]));
  }
  const after = await executeFile(wb, plan, { now: NOW, recipe, shouldStop: countingStop(free.calls + 1).stop });
  assert.equal(after.sha256, whole.sha256);
});

test('F2-08: a deadline that is already past stops before any match is looked for', async () => {
  const wb = await openSimple();
  const res = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf(), shouldStop: () => true });
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'm.timeout');
  assert.throws(() => replaceInText('abc', spec({ find: 'a' }), () => true), (e) => e.code === 'm.timeout');
});

test('F2-08: a slow replace over a very long text is stopped between matches', async () => {
  const wb = await openSimple();
  wb.queries[0].original = 'x'.repeat(200000);
  const state = countingStop(500);
  const res = await executeFile(wb, planOf([['query', 'StudentResults']]), { now: NOW, recipe: recipeOf({ find: 'x', with: 'y' }), shouldStop: state.stop });
  assert.equal(res.rows[0].reason_code, 'm.timeout');
  assert.equal(state.calls, 500);
});
