import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { checkSection } from '../../src/core/m/engine.js';
import { queryRemovalProblem, queryRenameProblem } from '../../src/core/pq/members.js';
import { moduleRemovalProblem, moduleNameProblem, moduleNameMap } from '../../src/core/vba/writeback.js';
import { REC } from '../../src/core/vba/dir-stream.js';
import { equalBytes } from '../../src/core/bytes.js';
import { fixture, generated } from './helpers.js';

const NOW = new Date(2026, 10, 14, 10, 0, 0);

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Alpha', 'beta', 'Gamma_2', 'Delta Query', 'Epsilon (copy)', 'let', 'x"y', 'Zeta', 'q1', 'Query With  Two Spaces', 'Eta.Sub', 'Theta', 'Iota', 'Kappa', 'Lambda'];
const bodies = (n) => [`let\n    n = ${n}\nin\n    n`, `let\n    Source = {1, 2, ${n}}\nin\n    Source`, `${n}`, `"text ${n}"`, `let\n    a = 1, // note\n    b = a + ${n}\nin\n    b`, `[ a = ${n}, b = "x" ]`];

async function step(wb, cs) {
  const res = await applyChangeSet(wb, cs, { now: NOW, checkSection });
  return openWorkbook(res.bytes, 'seq.xlsx');
}

test('writer sequences: many random add, remove, rename and replace steps keep the query list exact and warning-free', async () => {
  const done = { add: 0, remove: 0, rename: 0, replace: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    const rand = prng(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    let wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
    const model = new Map(wb.queries.map((q) => [q.name, q.original]));
    const trailing = wb.mashup.section.text.length - wb.mashup.section.text.trimEnd().length;
    for (let i = 0; i < 18; i++) {
      const cs = emptyChangeSet();
      const touched = new Set();
      const next = new Map(model);
      const ops = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < ops; k++) {
        const free = NAMES.filter((n) => ![...next.keys(), ...wb.queries.map((q) => q.name)].some((m) => m.toLowerCase() === n.toLowerCase()));
        const movable = [...next.keys()].filter((n) => wb.queries.some((q) => q.name === n) && !touched.has(n) && !wb.queries.find((q) => q.name === n).connection && !queryRemovalProblem(wb, n) && !queryRenameProblem(wb, n));
        const kind = pick(['add', 'add', 'remove', 'rename', 'replace']);
        if (kind === 'add' && free.length) {
          const name = pick(free);
          const text = pick(bodies(i * 10 + k));
          cs.queries.add.set(name, text);
          next.set(name, text);
        } else if (kind === 'remove' && movable.length) {
          const name = pick(movable);
          cs.queries.remove.add(name);
          touched.add(name);
          next.delete(name);
        } else if (kind === 'rename' && movable.length && free.length) {
          const from = pick(movable);
          const to = pick(free);
          cs.queries.rename.set(from, to);
          touched.add(from);
          const text = next.get(from);
          const entries = [...next].map(([n, t]) => (n === from ? [to, text] : [n, t]));
          next.clear();
          for (const [n, t] of entries) next.set(n, t);
        } else if (kind === 'replace' && next.size) {
          const name = pick([...next.keys()].filter((n) => !touched.has(n) && wb.queries.some((q) => q.name === n)));
          if (name) {
            const text = pick(bodies(i * 10 + k + 500));
            if (text !== wb.queries.find((q) => q.name === name).original) {
              cs.queries.replace.set(name, text);
              touched.add(name);
              next.set(name, text);
            }
          }
        }
      }
      const total = cs.queries.add.size + cs.queries.remove.size + cs.queries.rename.size + cs.queries.replace.size;
      if (!total) continue;
      done.add += cs.queries.add.size;
      done.remove += cs.queries.remove.size;
      done.rename += cs.queries.rename.size;
      done.replace += cs.queries.replace.size;
      wb = await step(wb, cs);
      const label = `seed ${seed} step ${i}`;
      assert.deepEqual(wb.warnings, [], label);
      const section = wb.mashup.section.text;
      assert.ok(!/(\r?\n)[ \t]*(\r?\n)[ \t]*(\r?\n)/.test(section), `${label}: more than one blank line in the section`);
      assert.ok(!/;[ \t]*\r?\n[ \t]*shared /.test(section), `${label}: a member follows another with no blank line`);
      assert.equal(section.length - section.trimEnd().length, trailing, `${label}: the section ends with different trailing space`);
      assert.equal((section.match(/^shared /gm) || []).length, next.size, `${label}: member count`);
      assert.deepEqual(wb.queries.map((q) => q.name).sort(), [...next.keys()].sort(), label);
      for (const q of wb.queries) assert.equal(q.original, next.get(q.name), `${label} ${q.name}`);
      model.clear();
      for (const [n, t] of next) model.set(n, t);
    }
  }
  for (const kind of Object.keys(done)) assert.ok(done[kind] >= 25, `${kind} ran ${done[kind]} times`);
});

test('writer sequences: random module add, remove and replace steps keep the project readable, writable and exact', async () => {
  const MODULE_NAMES = ['Utils', 'Helpers', 'Mod_A', 'Mod_B', 'Report', 'Calc', 'Main', 'Tools', 'Zed'];
  const done = { add: 0, remove: 0, replace: 0 };
  const code = (n) => `Sub S${n}()\n    Dim x As Long\n    x = ${n}\nEnd Sub\n`;
  for (let seed = 1; seed <= 12; seed++) {
    const rand = prng(seed * 7);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    let wb = await openWorkbook(generated('mixed.xlsm'), 'mixed.xlsm');
    const model = new Map(wb.vba.project.modules.map((m) => [m.name, m.model.visible]));
    for (let i = 0; i < 16; i++) {
      const cs = emptyChangeSet();
      const touched = new Set();
      const next = new Map(model);
      const project = wb.vba.project;
      const ops = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < ops; k++) {
        const kind = pick(['add', 'add', 'remove', 'replace']);
        const free = MODULE_NAMES.filter((n) => !moduleNameProblem(project, n) && !cs.modules.add.has(n));
        const removable = [...model.keys()].filter((n) => !touched.has(n) && !moduleRemovalProblem(project, n));
        if (kind === 'add' && free.length) {
          const name = pick(free);
          const text = code(i * 10 + k);
          cs.modules.add.set(name, text);
          next.set(name, text);
        } else if (kind === 'remove' && removable.length) {
          const name = pick(removable);
          cs.modules.remove.add(name);
          touched.add(name);
          next.delete(name);
        } else if (kind === 'replace') {
          const name = pick([...model.keys()].filter((n) => !touched.has(n) && project.modules.find((m) => m.name === n).kind !== 'form'));
          if (name) {
            const text = `${code(i * 10 + k + 300)}`;
            if (text !== model.get(name)) {
              cs.modules.replace.set(name, text);
              touched.add(name);
              next.set(name, text);
            }
          }
        }
      }
      const total = cs.modules.add.size + cs.modules.remove.size + cs.modules.replace.size;
      if (!total) continue;
      done.add += cs.modules.add.size;
      done.remove += cs.modules.remove.size;
      done.replace += cs.modules.replace.size;
      wb = await step(wb, cs);
      const label = `seed ${seed} step ${i}`;
      const back = wb.vba.project;
      assert.deepEqual(back.anomalies, [], label);
      assert.equal(back.writable, true, label);
      assert.deepEqual(back.modules.map((m) => m.name).sort(), [...next.keys()].sort(), label);
      for (const m of back.modules) assert.equal(m.model.visible, next.get(m.name), `${label} ${m.name}`);
      const count = (id) => back.records.filter((r) => r.id === id).length;
      assert.equal(count(REC.MODULE_NAME), back.modules.length, `${label}: name records`);
      assert.equal(count(REC.MODULE_TERMINATOR), back.modules.length, `${label}: terminator records`);
      assert.equal(count(REC.MODULE_OFFSET), back.modules.length, `${label}: offset records`);
      assert.deepEqual([...back.projectInfo.modules].sort(), back.modules.filter((m) => m.kind === 'standard').map((m) => m.name).sort(), `${label}: PROJECT module lines`);
      const mapNode = back.cfb.root.children.find((c) => c.name === 'PROJECTwm');
      assert.ok(equalBytes(mapNode.data, moduleNameMap(back.modules.map((m) => m.name), back.codePage)), `${label}: name map`);
      const vbaNode = back.cfb.root.children.find((c) => c.name === 'VBA');
      const streams = vbaNode.children.map((c) => c.name).filter((n) => !['dir', '_VBA_PROJECT'].includes(n)).sort();
      assert.deepEqual(streams, back.modules.map((m) => m.streamName).sort(), `${label}: module streams`);
      assert.deepEqual(wb.warnings, [], label);
      model.clear();
      for (const [n, t] of next) model.set(n, t);
    }
  }
  for (const kind of Object.keys(done)) assert.ok(done[kind] >= 25, `${kind} ran ${done[kind]} times`);
});

test('writer sequences: the same random sequence gives the same bytes twice', async () => {
  const run = async () => {
    const rand = prng(99);
    let wb = await openWorkbook(fixture('pq_simple.xlsx'), 'pq_simple.xlsx');
    let last;
    for (let i = 0; i < 6; i++) {
      const cs = emptyChangeSet();
      cs.queries.add.set(`Added${i}`, `let\n    n = ${Math.floor(rand() * 1000)}\nin\n    n`);
      last = await applyChangeSet(wb, cs, { now: NOW, checkSection });
      wb = await openWorkbook(last.bytes, 'seq.xlsx');
    }
    return Buffer.from(last.bytes).toString('base64');
  };
  assert.equal(await run(), await run());
});
