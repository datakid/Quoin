import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openWorkbook } from '../../src/core/workbook.js';
import { buildWorkbook, applyChangeSet, emptyChangeSet, selfCheck } from '../../src/core/save.js';
import { fixture, generated } from './helpers.js';

process.env.TZ = 'UTC';

const BETA_CLOCK = Date.UTC(2026, 10, 14, 10, 0, 0);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dos = (entry) => ({
  year: 1980 + (entry.modDate >> 9),
  month: (entry.modDate >> 5) & 15,
  day: entry.modDate & 31,
  hour: entry.modTime >> 11,
  minute: (entry.modTime >> 5) & 63,
  second: (entry.modTime & 31) * 2
});

const scenarios = [
  { label: 'a query edit with refresh on open', load: () => fixture('pq_simple.xlsx'), file: 'pq_simple.xlsx', q: ['StudentResults'], refreshOnLoad: true, sha: '5995e981a8c139f4e9865113f3159c1221d31760eac40f99ce3cc207f081f58d' },
  { label: 'a query edit without refresh on open', load: () => fixture('pq_simple.xlsx'), file: 'pq_simple.xlsx', q: ['StudentResults'], refreshOnLoad: false, sha: 'e6c847e58f2bf99d77ce98dfe4cc036fa3d7650be6689be9244e1fa99cf2a401' },
  { label: 'a query edit and a module edit', load: () => generated('mixed.xlsm'), file: 'mixed.xlsm', q: ['FinalTable'], m: ['Module1'], refreshOnLoad: true, sha: '8579452fd515f7b3e28d7db20e2e69508bee58bdd634f856f02f6abf897f99f5' },
  { label: 'a module edit in a signed project', load: () => generated('signed.xlsm'), file: 'signed.xlsm', m: ['Module1'], refreshOnLoad: true, ack: true, sha: 'dba2f829aa3c6d78b1f6a37663d4085847ab37a15129277e7ca9d59a95327082' },
  { label: 'a save with no edits', load: () => fixture('pq_vba_complex.xlsm'), file: 'pq_vba_complex.xlsm', refreshOnLoad: true, sha: 'cb6e3e463595c1a6234cf0872254afdd03fa939508099fb3d6d85737abdb734d' },
  { label: 'a query edit in a template', load: () => fixture('ms_template_query.xlsx'), file: 'ms_template_query.xlsx', q: ['Query1'], refreshOnLoad: true, sha: '0a213ca8e8b01396e13684b92e11d2d765b8d19e23de6ead2ee920ae39bc8a89' }
];

async function edits(s) {
  const wb = await openWorkbook(s.load(), s.file);
  const queryEdits = new Map((s.q || []).map((n) => [n, `${wb.queries.find((x) => x.name === n).original}\n// edit`]));
  const vbaEdits = new Map((s.m || []).map((n) => [n, `${wb.vba.project.modules.find((x) => x.name === n).model.visible}\n' edit\n`]));
  return { wb, queryEdits, vbaEdits };
}

function changeSetFor(queryEdits, vbaEdits, ack = false) {
  const cs = emptyChangeSet();
  for (const [n, t] of queryEdits) cs.queries.replace.set(n, t);
  for (const [n, t] of vbaEdits) cs.modules.replace.set(n, t);
  cs.acknowledgeSignature = ack;
  return cs;
}

for (const s of scenarios) {
  test(`F2-01: buildWorkbook gives the same bytes as before for ${s.label}`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: BETA_CLOCK });
    const { wb, queryEdits, vbaEdits } = await edits(s);
    const res = await buildWorkbook(wb, { queryEdits, vbaEdits, refreshOnLoad: s.refreshOnLoad, acknowledgeSignature: !!s.ack });
    assert.equal(sha(res.bytes), s.sha);
  });

  test(`F2-01: applyChangeSet with that clock frozen gives the same bytes for ${s.label}`, async () => {
    const { wb, queryEdits, vbaEdits } = await edits(s);
    const res = await applyChangeSet(wb, changeSetFor(queryEdits, vbaEdits, !!s.ack), { now: new Date(2026, 10, 14, 10, 0, 0), refreshOnLoad: s.refreshOnLoad });
    assert.equal(sha(res.bytes), s.sha);
    assert.equal(res.queriesChanged, (s.q || []).length);
    assert.equal(res.modulesChanged, (s.m || []).length);
  });
}

test('F2-01: the same now gives byte-identical output, and now reaches the package and the query data', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: BETA_CLOCK });
  const s = scenarios[2];
  const { wb, queryEdits, vbaEdits } = await edits(s);
  const frozen = new Date(2026, 11, 1, 8, 30, 0);
  const first = await applyChangeSet(wb, changeSetFor(queryEdits, vbaEdits), { now: frozen });
  t.mock.timers.tick(20000);
  const second = await applyChangeSet(wb, changeSetFor(queryEdits, vbaEdits), { now: frozen });
  assert.equal(sha(first.bytes), sha(second.bytes));
  assert.notEqual(sha(first.bytes), s.sha);
  const back = await openWorkbook(first.bytes, s.file);
  const stamp = { year: 2026, month: 12, day: 1, hour: 8, minute: 30, second: 0 };
  assert.deepEqual(dos(back.pkg.zip.get(back.mashup.part)), stamp);
  assert.deepEqual(dos(back.mashup.model.packageParts.get('Formulas/Section1.m')), stamp);
  assert.deepEqual(dos(back.pkg.zip.get(back.vba.part)), stamp);
});

test('F2-01: a query named in the change set refreshes on open even when the global option is off', async () => {
  const s = scenarios[1];
  const { wb, queryEdits } = await edits(s);
  const cs = changeSetFor(queryEdits, new Map());
  cs.refreshOnLoad.add('StudentResults');
  const res = await applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0), refreshOnLoad: false });
  assert.equal(sha(res.bytes), scenarios[0].sha);
  const back = await openWorkbook(res.bytes, s.file);
  assert.equal(back.queries[0].connection.refreshOnLoad, true);
});

test('F2-01: a refresh name that is not edited changes nothing', async () => {
  const s = scenarios[1];
  const { wb, queryEdits } = await edits(s);
  const cs = changeSetFor(queryEdits, new Map());
  cs.refreshOnLoad.add('SomethingElse');
  const res = await applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0), refreshOnLoad: false });
  assert.equal(sha(res.bytes), s.sha);
});

test('F2-01: an empty change set writes a package that opens with the same queries', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const res = await applyChangeSet(wb, emptyChangeSet(), { now: new Date(2026, 10, 14, 10, 0, 0) });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.deepEqual(back.queries.map((q) => q.name), wb.queries.map((q) => q.name));
  assert.equal(res.queriesChanged, 0);
  assert.equal(res.modulesChanged, 0);
});

test('F2-01: a partial change set is completed, so a caller names only what it changes', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const res = await applyChangeSet(wb, { queries: { replace: new Map([['StudentResults', `${wb.queries[0].original}\n// partial`]]) } }, { now: new Date(2026, 10, 14, 10, 0, 0) });
  const back = await openWorkbook(res.bytes, 'x.xlsx');
  assert.ok(back.queries[0].original.endsWith('// partial'));
});

test('F2-01: change kinds that are not applied yet are refused and never ignored', async () => {
  const wb = await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
  const refused = [
    (cs) => cs.modules.add.set('Module9', 'Option Explicit'),
    (cs) => cs.modules.remove.add('Module1'),
    (cs) => cs.sheets.add.push({ name: 'Result', cells: [] }),
    (cs) => cs.sheets.write.push({ sheet: 'Sheet1', range: 'A1', cells: [] })
  ];
  for (const set of refused) {
    const cs = emptyChangeSet();
    set(cs);
    await assert.rejects(() => applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0) }), TypeError);
  }
});

test('F2-01: selfCheck rejects an untouched part that changed', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  wb.pkg.set('xl/workbook.xml', new TextEncoder().encode(`${await wb.pkg.text('xl/workbook.xml').then((t) => t.text)} `));
  const cs = emptyChangeSet();
  cs.queries.replace.set('StudentResults', `${wb.queries[0].original}\n// x`);
  await assert.rejects(() => applyChangeSet(wb, cs), (e) => e.code === 'write.selfcheck' && e.part === 'xl/workbook.xml');
});

test('F2-01: selfCheck rejects a part that appears without being declared', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  wb.pkg.set('xl/extra.bin', new Uint8Array([1, 2, 3]));
  await assert.rejects(() => applyChangeSet(wb, emptyChangeSet()), (e) => e.code === 'write.selfcheck' && e.part === 'xl/extra.bin');
});

test('F2-01: selfCheck rejects a part that disappears without being declared', async () => {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  wb.pkg.remove('xl/styles.xml');
  await assert.rejects(() => applyChangeSet(wb, emptyChangeSet()), (e) => e.code === 'write.selfcheck' && e.part === 'xl/styles.xml');
});

async function plainOutput() {
  const wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
  const res = await applyChangeSet(wb, emptyChangeSet(), { now: new Date(2026, 10, 14, 10, 0, 0) });
  return { wb, bytes: res.bytes };
}

const declared = (over = {}) => ({
  changes: emptyChangeSet(),
  touched: new Set(),
  addedParts: new Set(),
  removedParts: new Set(),
  signatureRemoved: false,
  ...over
});

test('F2-01: selfCheck accepts an exact declaration of no change', async () => {
  const { wb, bytes } = await plainOutput();
  await selfCheck(wb, bytes, declared());
});

test('F2-01: selfCheck rejects an add that is missing from the output', async () => {
  const { wb, bytes } = await plainOutput();
  const changes = emptyChangeSet();
  changes.queries.add.set('Ghost', '1');
  await assert.rejects(() => selfCheck(wb, bytes, declared({ changes })), (e) => e.code === 'write.selfcheck' && e.part === 'Ghost');
});

test('F2-01: selfCheck rejects a rename that left the old name in place', async () => {
  const { wb, bytes } = await plainOutput();
  const changes = emptyChangeSet();
  changes.queries.rename.set('StudentResults', 'Renamed');
  await assert.rejects(() => selfCheck(wb, bytes, declared({ changes })), (e) => e.code === 'write.selfcheck' && e.part === 'StudentResults');
});

test('F2-01: selfCheck rejects a remove that left the query in place', async () => {
  const { wb, bytes } = await plainOutput();
  const changes = emptyChangeSet();
  changes.queries.remove.add('StudentResults');
  await assert.rejects(() => selfCheck(wb, bytes, declared({ changes })), (e) => e.code === 'write.selfcheck' && e.part === 'StudentResults');
});

test('F2-01: selfCheck rejects a declared part that is not in the output', async () => {
  const { wb, bytes } = await plainOutput();
  await assert.rejects(() => selfCheck(wb, bytes, declared({ addedParts: new Set(['xl/worksheets/sheet9.xml']) })), (e) => e.code === 'write.selfcheck' && e.part === 'xl/worksheets/sheet9.xml');
});

test('F2-01: selfCheck rejects a declared removal that is still in the output', async () => {
  const { wb, bytes } = await plainOutput();
  await assert.rejects(() => selfCheck(wb, bytes, declared({ removedParts: new Set(['xl/styles.xml']) })), (e) => e.code === 'write.selfcheck' && e.part === 'xl/styles.xml');
});

test('F2-01: selfCheck rejects a module that the declaration does not expect', async () => {
  const wb = await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
  const cs = emptyChangeSet();
  cs.modules.replace.set('Module1', `${wb.vba.project.modules.find((m) => m.name === 'Module1').model.visible}\n' x\n`);
  const res = await applyChangeSet(wb, cs, { now: new Date(2026, 10, 14, 10, 0, 0) });
  const changes = emptyChangeSet();
  changes.modules.remove.add('Module1');
  await assert.rejects(() => selfCheck(wb, res.bytes, declared({ changes, touched: new Set([wb.vba.part]) })), (e) => e.code === 'write.selfcheck' && e.part === 'Module1');
});
