import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { executeFile } from '../../src/batch/execute/index.js';
import { buildDataMashup } from '../../src/core/pq/datamashup.js';
import { base64Encode } from '../../src/core/bytes.js';
import { applyEdits, parseXml, textContentEdit } from '../../src/core/xml.js';
import { fixture, generated } from './helpers.js';

const NOW = '2026-11-14T10:00:00.000Z';
const NEW_M = 'let\n    Source = 1\nin\n    Source';
const NEW_VBA = 'Sub Added()\n    MsgBox "added"\nEnd Sub\n';
const unit = { fileId: 'f0001', kind: 'workbook', name: 'f', index: 1 };
const planOf = (op, targets) => ({ fileId: 'f0001', source: 'rule', units: [unit], actions: targets.map(([type, name]) => ({ unit, op, target: { type, name }, compute: null, output: null, replaces: null })), skipped: null });
const inject = (over) => ({ recipe: 'inject', v: 1, scope: { type: 'workbook', match: 'all', excludeHidden: true }, inject: { target: 'query', op: 'add', match: 'name', name: 'Extra', newName: null, source: 'inline', text: NEW_M, refreshOnLoad: false, ...over } });
const replaceRecipe = (over) => ({ recipe: 'replace', v: 1, replace: { in: ['m', 'vba'], find: 'DateTime', with: 'MyDateTime', kind: 'text', matchCase: true, ...over } });
const openSimple = () => openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
const openMixed = () => openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const moduleOf = (wb, name) => wb.vba.project.modules.find((m) => m.name === name);

async function snapshot(wb) {
  const parts = [];
  for (const e of wb.pkg.zip.entries) parts.push([e.name, sha(await e.read())]);
  return {
    parts,
    queries: wb.queries.map((q) => [q.name, q.original]),
    modules: wb.vba && wb.vba.project ? wb.vba.project.modules.map((m) => [m.name, m.text]) : [],
    warnings: JSON.stringify(wb.warnings)
  };
}

const scenarios = [
  { label: 'replace a query', open: openSimple, plan: planOf('replace', [['query', 'StudentResults']]), recipe: inject({ op: 'replace', name: 'StudentResults', text: 'let\n    Source = 2\nin\n    Source' }) },
  { label: 'add a query', open: openSimple, plan: planOf('add', [['query', 'Extra']]), recipe: inject({}) },
  { label: 'replace a module', open: openMixed, plan: planOf('replace', [['module', 'Module1']]), recipe: inject({ target: 'module', op: 'replace', name: 'Module1', text: NEW_VBA }) },
  { label: 'add a module', open: openMixed, plan: planOf('add', [['module', 'Module2']]), recipe: inject({ target: 'module', op: 'add', name: 'Module2', text: NEW_VBA }) },
  { label: 'remove a module', open: openMixed, plan: planOf('remove', [['module', 'Module1']]), recipe: inject({ target: 'module', op: 'remove', name: 'Module1' }) },
  { label: 'replace text', open: openMixed, plan: planOf('replaceText', [['query', 'FinalTable'], ['module', 'Module1']]), recipe: replaceRecipe({ find: '(DateTime|MsgBox)', with: 'My$1', kind: 'regex' }) }
];

for (const s of scenarios) {
  test(`writer contract: ${s.label} leaves its inputs unchanged`, async () => {
    const wb = await s.open();
    const before = await snapshot(wb);
    const plan = structuredClone(s.plan);
    const recipe = structuredClone(s.recipe);
    const res = await executeFile(wb, s.plan, { now: NOW, recipe: s.recipe });
    assert.ok(res.bytes);
    assert.deepEqual(await snapshot(wb), before);
    assert.deepEqual(s.plan, plan);
    assert.deepEqual(s.recipe, recipe);
  });

  test(`writer contract: ${s.label} gives plain data that survives structuredClone`, async () => {
    const res = await executeFile(await s.open(), s.plan, { now: NOW, recipe: s.recipe });
    const copy = structuredClone(res);
    assert.deepEqual(copy, res);
    assert.ok(copy.bytes instanceof Uint8Array);
  });

  test(`writer contract: ${s.label} reopens with no new warning and can be saved again`, async () => {
    const wb = await s.open();
    const res = await executeFile(wb, s.plan, { now: NOW, recipe: s.recipe });
    const back = await openWorkbook(res.bytes, 'out.xlsx');
    assert.deepEqual(back.warnings, wb.warnings);
    const again = await applyChangeSet(back, emptyChangeSet(), { now: new Date(2026, 10, 14, 10, 0, 0) });
    const third = await openWorkbook(again.bytes, 'again.xlsx');
    assert.deepEqual(third.queries.map((q) => [q.name, q.original]), back.queries.map((q) => [q.name, q.original]));
    assert.deepEqual(third.vba ? third.vba.project.modules.map((m) => [m.name, m.text]) : null, back.vba ? back.vba.project.modules.map((m) => [m.name, m.text]) : null);
    assert.deepEqual(third.warnings, wb.warnings);
  });

  test(`writer contract: ${s.label} gives the same bytes in any time zone`, async () => {
    const zone = process.env.TZ;
    const hashes = [];
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']) {
        process.env.TZ = tz;
        const res = await executeFile(await s.open(), s.plan, { now: NOW, recipe: s.recipe });
        hashes.push(res.sha256);
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    assert.equal(new Set(hashes).size, 1);
  });
}

test('writer contract: applyChangeSet does not change the ChangeSet it is given', async () => {
  const wb = await openMixed();
  const cs = emptyChangeSet();
  cs.queries.add.set('Extra', NEW_M);
  cs.queries.replace.set('FinalTable', `${wb.queries.find((q) => q.name === 'FinalTable').original}\n// edit`);
  cs.modules.add.set('Module2', NEW_VBA);
  cs.modules.remove.add('Module1');
  cs.refreshOnLoad.add('FinalTable');
  const copy = structuredClone(cs);
  await applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0) });
  assert.deepEqual(cs, copy);
});

test('writer contract: actions in reverse order give the same bytes and the same rows', async () => {
  const targets = [['query', 'FinalTable'], ['module', 'Module1'], ['query', 'RawInput'], ['module', 'ThisWorkbook']];
  const recipe = replaceRecipe({ find: '(DateTime|MsgBox|Raw)', with: 'My$1', kind: 'regex' });
  const forward = await executeFile(await openMixed(), planOf('replaceText', targets), { now: NOW, recipe });
  const reverse = await executeFile(await openMixed(), planOf('replaceText', [...targets].reverse()), { now: NOW, recipe });
  assert.equal(forward.sha256, reverse.sha256);
  const key = (r) => `${r.unit}|${r.action}|${r.verdict}|${r.old_hash}|${r.new_hash}`;
  assert.deepEqual(forward.rows.map(key).sort(), reverse.rows.map(key).sort());
});

test('writer contract: a plan with no actions writes nothing and has no rows', async () => {
  const res = await executeFile(await openSimple(), planOf('replace', []), { now: NOW, recipe: inject({ op: 'replace' }) });
  assert.ok(res.bytes === null && res.sha256 === null);
  assert.deepEqual(res.rows, []);
  assert.deepEqual(res.changes, []);
});

test('writer contract: one target named twice in a plan is refused the second time, not written twice', async () => {
  const wb = await openSimple();
  const plan = planOf('replace', [['query', 'StudentResults'], ['query', 'StudentResults']]);
  const res = await executeFile(wb, plan, { now: NOW, recipe: inject({ op: 'replace', name: 'StudentResults' }) });
  assert.deepEqual(res.rows.map((r) => [r.verdict, r.reason_code]), [['changed', ''], ['refused', 'refused.duplicate']]);
  assert.equal(res.changes.length, 1);
  const cased = await executeFile(wb, planOf('replace', [['query', 'StudentResults'], ['query', 'studentresults']]), { now: NOW, recipe: inject({ op: 'replace', name: 'StudentResults' }) });
  assert.equal(cased.rows[1].reason_code, 'skip.notApplicable');
  const both = await executeFile(await openMixed(), planOf('replace', [['query', 'FinalTable'], ['module', 'FinalTable']]), { now: NOW, recipe: inject({ op: 'replace', name: 'FinalTable' }) });
  assert.ok(!both.rows.some((r) => r.reason_code === 'refused.duplicate'));
});

async function mismatchedWorkbook() {
  const wb = await openSimple();
  const m = wb.mashup;
  const section = { text: `${m.section.text}\r\n\r\nshared Ghost = 1;`, bom: m.section.bom };
  const encoded = base64Encode(await buildDataMashup(m.model, section));
  const pkg = wb.pkg.clone();
  await pkg.setText(m.part, applyEdits(m.text.text, [textContentEdit(parseXml(m.text.text, m.part).root, encoded)]), m.text);
  return openWorkbook(await pkg.write({ now: new Date(2026, 10, 14, 10, 0, 0) }), 'bad.xlsx');
}

test('writer contract: a file that opens with a warning passes the warning on, and a write that would build on it fails the row', async () => {
  const wb = await mismatchedWorkbook();
  assert.ok(wb.warnings.some((w) => w.code === 'pq.countMismatch'));
  const res = await executeFile(wb, planOf('add', [['query', 'Extra']]), { now: NOW, recipe: inject({}) });
  assert.ok(res.bytes === null);
  assert.ok(res.warnings.some((w) => w.code === 'pq.countMismatch'));
  assert.equal(res.rows[0].verdict, 'failed');
  assert.equal(res.rows[0].reason_code, 'pq.format');
});

test('writer contract: an added query never creates a connection, a table, a sheet or any new part (Q5)', async () => {
  const wb = await openSimple();
  const res = await executeFile(wb, planOf('add', [['query', 'Extra']]), { now: NOW, recipe: inject({ refreshOnLoad: true }) });
  const back = await openWorkbook(res.bytes, 'out.xlsx');
  assert.deepEqual(back.pkg.zip.entries.map((e) => e.name), wb.pkg.zip.entries.map((e) => e.name));
  assert.equal(sha(await back.pkg.zip.get(back.connections.part).read()), sha(await wb.pkg.zip.get(wb.connections.part).read()));
  const added = back.queries.find((q) => q.name === 'Extra');
  assert.equal(added.connection, null);
  assert.deepEqual(added.load, { kind: 'connection' });
  assert.deepEqual(back.tables, wb.tables);
});

test('writer contract: a removal never deletes a query that loads to a table or has a connection (Q5)', async () => {
  const wb = await openMixed();
  for (const q of wb.queries) {
    const res = await executeFile(wb, planOf('remove', [['query', q.name]]), { now: NOW, recipe: inject({ op: 'remove', name: q.name }) });
    assert.ok(res.bytes === null, q.name);
    assert.equal(res.rows[0].verdict, 'refused', q.name);
    assert.equal(res.rows[0].reason_code, 'refused.loaded', q.name);
  }
});

test('writer contract: forty added queries, then some removed and some replaced, all read back and nothing warns', async () => {
  const wb = await openSimple();
  const cs = emptyChangeSet();
  for (let i = 0; i < 40; i++) cs.queries.add.set(`Q${String(i).padStart(2, '0')}`, `let\n    n = ${i}\nin\n    n`);
  const first = await applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0) });
  const mid = await openWorkbook(first.bytes, 'mid.xlsx');
  assert.equal(mid.queries.length, 41);
  assert.deepEqual(mid.warnings, []);
  const next = emptyChangeSet();
  for (let i = 0; i < 40; i += 3) next.queries.remove.add(`Q${String(i).padStart(2, '0')}`);
  for (let i = 1; i < 40; i += 5) if (i % 3 !== 0) next.queries.replace.set(`Q${String(i).padStart(2, '0')}`, `let\n    n = ${i + 100}\nin\n    n`);
  const second = await applyChangeSet(mid, next, { now: new Date(2026, 10, 14, 10, 0, 0) });
  const last = await openWorkbook(second.bytes, 'last.xlsx');
  assert.equal(last.queries.length, 41 - next.queries.remove.size);
  assert.deepEqual(last.warnings, []);
  for (const [name, text] of next.queries.replace) assert.equal(last.queries.find((q) => q.name === name).original, text);
  assert.ok(!last.queries.some((q) => next.queries.remove.has(q.name)));
});
