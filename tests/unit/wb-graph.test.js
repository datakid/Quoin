import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, layerNodes, neighbourhood, pathsOf, impactOf, countCrossings, NODE_W, NODE_H, GAP_X, GAP_Y } from '../../src/core/wb/graph-layout.js';

const edgesOf = (pairs) => pairs.map((p) => p.split('>'));

test('T-WB-17: longest-path layering puts sources left and outputs right', () => {
  const nodes = ['A', 'B', 'C', 'D'];
  const { layer } = layerNodes(nodes, edgesOf(['A>B', 'A>C', 'B>C', 'C>D']));
  assert.deepEqual([...layer], [['A', 0], ['B', 1], ['C', 2], ['D', 3]]);
});

test('T-WB-17: the layout is deterministic and the coordinates are integers', () => {
  const nodes = ['A', 'B', 'C', 'D', 'E'];
  const edges = edgesOf(['A>C', 'B>C', 'C>D', 'C>E']);
  const a = layoutGraph(nodes, edges);
  const b = layoutGraph(nodes, edges);
  assert.deepEqual([...a.nodes], [...b.nodes]);
  for (const p of a.nodes.values()) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
  }
  assert.equal(a.nodes.get('A').x, 0);
  assert.equal(a.nodes.get('C').x, NODE_W + GAP_X);
  assert.equal(a.nodes.get('D').x, 2 * (NODE_W + GAP_X));
});

test('T-WB-17: a tree lays out with no crossings and the layers are centred on the tallest one', () => {
  const nodes = ['R', 'A', 'B', 'A1', 'A2', 'B1', 'B2'];
  const edges = edgesOf(['R>A', 'R>B', 'A>A1', 'A>A2', 'B>B1', 'B>B2']);
  const g = layoutGraph(nodes, edges);
  assert.equal(g.crossings, 0);
  const rootY = g.nodes.get('R').y;
  assert.ok(rootY > 0);
  assert.equal(g.height, 4 * NODE_H + 3 * GAP_Y);
});

test('T-WB-17: barycentric sweeps remove a crossing that the input order creates', () => {
  const nodes = ['S1', 'S2', 'T1', 'T2'];
  const edges = edgesOf(['S1>T2', 'S2>T1']);
  const g = layoutGraph(nodes, edges);
  assert.equal(g.crossings, 0);
  assert.equal(countCrossings(new Map([['S1', 0], ['S2', 0], ['T1', 1], ['T2', 1]]), edges, new Map([['S1', 0], ['S2', 1], ['T1', 0], ['T2', 1]])), 1);
});

test('T-WB-17: a cycle is laid out without looping and its closing edge is marked cyclic', () => {
  const g = layoutGraph(['A', 'B', 'C'], edgesOf(['A>B', 'B>C', 'C>A']));
  assert.equal(g.nodes.size, 3);
  assert.deepEqual(g.edges.filter((e) => e.cyclic).map((e) => [e.from, e.to]), [['C', 'A']]);
  const self = layoutGraph(['A'], edgesOf(['A>A']));
  assert.equal(self.edges.length, 0);
});

test('T-WB-17: unknown endpoints and duplicate edges are ignored, an empty graph is empty', () => {
  const g = layoutGraph(['A', 'B'], [['A', 'B'], ['A', 'B'], ['A', 'Z']]);
  assert.equal(g.edges.length, 1);
  assert.deepEqual(layoutGraph([], []), { nodes: new Map(), edges: [], width: 0, height: 0, layers: [], crossings: 0 });
});

test('T-WB-17: an edge path runs from the right of the source to the left of the target', () => {
  const g = layoutGraph(['A', 'B'], edgesOf(['A>B']));
  const a = g.nodes.get('A');
  const b = g.nodes.get('B');
  assert.match(g.edges[0].path, new RegExp(`^M${a.x + NODE_W} ${a.y + NODE_H / 2}C`));
  assert.ok(g.edges[0].path.endsWith(`${b.x} ${b.y + NODE_H / 2}`));
});

test('T-WB-17: the neighbourhood is two levels each way by default and can be widened', () => {
  const edges = edgesOf(['A>B', 'B>C', 'C>D', 'D>E', 'E>F', 'X>C']);
  assert.deepEqual([...neighbourhood(edges, 'C')].sort(), ['A', 'B', 'C', 'D', 'E', 'X']);
  assert.deepEqual([...neighbourhood(edges, 'C', 1)].sort(), ['B', 'C', 'D', 'X']);
  assert.deepEqual([...neighbourhood(edges, 'C', 9)].sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'X']);
});

test('T-WB-17: upstream and downstream paths are separate sets', () => {
  const edges = edgesOf(['A>B', 'B>C', 'C>D', 'X>C', 'Y>Z']);
  const p = pathsOf(edges, 'C');
  assert.deepEqual([...p.up].sort(), ['A', 'B', 'X']);
  assert.deepEqual([...p.down], ['D']);
});

test('T-WB-17: the impact count says how many queries and how many are loaded to sheets', () => {
  assert.deepEqual(impactOf(new Set(['B', 'C', 'D']), (n) => n !== 'C'), { count: 3, loaded: 2 });
  assert.deepEqual(impactOf(new Set(), () => true), { count: 0, loaded: 0 });
});

test('T-WB-17: three hundred and twenty nodes lay out in under 200 ms', () => {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 320; i++) {
    nodes.push(`Q${i}`);
    if (i > 0) edges.push([`Q${Math.floor(i / 3)}`, `Q${i}`]);
    if (i > 9) edges.push([`Q${i % 10}`, `Q${i}`]);
  }
  const t0 = performance.now();
  const g = layoutGraph(nodes, edges);
  const ms = performance.now() - t0;
  assert.equal(g.nodes.size, 320);
  assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
});
