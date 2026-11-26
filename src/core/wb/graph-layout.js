export const NODE_W = 168;
export const NODE_H = 32;
export const GAP_X = 72;
export const GAP_Y = 14;

export function layerNodes(nodes, edges) {
  const out = new Map(nodes.map((n) => [n, []]));
  const known = new Set(nodes);
  for (const [a, b] of edges) if (known.has(a) && known.has(b) && a !== b) out.get(a).push(b);
  const preds = new Map(nodes.map((n) => [n, []]));
  for (const [a, list] of out) for (const b of list) preds.get(b).push(a);
  const state = new Map();
  const back = new Set();
  const order = [];
  for (const root of nodes) {
    if (state.has(root)) continue;
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, i] = top;
      if (i < out.get(v).length) {
        top[1]++;
        const w = out.get(v)[i];
        if (!state.has(w)) {
          state.set(w, 1);
          stack.push([w, 0]);
        } else if (state.get(w) === 1) back.add(`${v}\u0000${w}`);
      } else {
        state.set(v, 2);
        order.push(v);
        stack.pop();
      }
    }
  }
  order.reverse();
  const layer = new Map(nodes.map((n) => [n, 0]));
  for (const v of order) for (const w of out.get(v)) if (!back.has(`${v}\u0000${w}`)) layer.set(w, Math.max(layer.get(w), layer.get(v) + 1));
  return { layer, back, preds, out };
}

function barycenter(neigh, pos, own) {
  if (!neigh.length) return own;
  let sum = 0;
  for (const n of neigh) sum += pos.get(n);
  return sum / neigh.length;
}

export function countCrossings(columns, edges, pos) {
  let n = 0;
  const byLayer = new Map();
  for (const [a, b] of edges) {
    const la = columns.get(a);
    const lb = columns.get(b);
    if (la === undefined || lb === undefined || lb !== la + 1) continue;
    if (!byLayer.has(la)) byLayer.set(la, []);
    byLayer.get(la).push([pos.get(a), pos.get(b)]);
  }
  for (const list of byLayer.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if ((list[i][0] - list[j][0]) * (list[i][1] - list[j][1]) < 0) n++;
  }
  return n;
}

export function layoutGraph(nodes, edges, { sweeps = 4 } = {}) {
  const { layer, back, preds, out } = layerNodes(nodes, edges);
  const count = nodes.length ? Math.max(...layer.values()) + 1 : 0;
  const columns = Array.from({ length: count }, () => []);
  for (const n of nodes) columns[layer.get(n)].push(n);
  const pos = new Map();
  const reindex = () => columns.forEach((col) => col.forEach((n, i) => pos.set(n, i)));
  reindex();
  const sortColumn = (col, neighbours) => {
    const key = new Map(col.map((n, i) => [n, barycenter(neighbours.get(n), pos, i)]));
    col.sort((a, b) => key.get(a) - key.get(b) || pos.get(a) - pos.get(b));
    col.forEach((n, i) => pos.set(n, i));
  };
  const forward = new Map(nodes.map((n) => [n, preds.get(n).filter((p) => !back.has(`${p}\u0000${n}`))]));
  const backward = new Map(nodes.map((n) => [n, out.get(n).filter((s) => !back.has(`${n}\u0000${s}`))]));
  for (let s = 0; s < sweeps; s++) {
    if (s % 2 === 0) for (let c = 1; c < columns.length; c++) sortColumn(columns[c], forward);
    else for (let c = columns.length - 2; c >= 0; c--) sortColumn(columns[c], backward);
  }
  const tallest = Math.max(0, ...columns.map((c) => c.length));
  const placed = new Map();
  columns.forEach((col, c) => {
    const offset = Math.floor(((tallest - col.length) * (NODE_H + GAP_Y)) / 2);
    col.forEach((n, i) => placed.set(n, { x: c * (NODE_W + GAP_X), y: offset + i * (NODE_H + GAP_Y), layer: c, order: i }));
  });
  const edgeList = [];
  const seen = new Set();
  for (const [a, b] of edges) {
    if (!placed.has(a) || !placed.has(b) || a === b) continue;
    const id = `${a}\u0000${b}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const pa = placed.get(a);
    const pb = placed.get(b);
    const x1 = pa.x + NODE_W;
    const y1 = pa.y + NODE_H / 2;
    const x2 = pb.x;
    const y2 = pb.y + NODE_H / 2;
    const mid = Math.round((x1 + x2) / 2);
    edgeList.push({ from: a, to: b, cyclic: back.has(id), path: `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}` });
  }
  return {
    nodes: placed,
    edges: edgeList,
    width: columns.length ? columns.length * NODE_W + (columns.length - 1) * GAP_X : 0,
    height: tallest ? tallest * NODE_H + (tallest - 1) * GAP_Y : 0,
    layers: columns.map((c) => c.slice()),
    crossings: countCrossings(layer, edges, pos)
  };
}

export function neighbourhood(edges, start, levels = 2) {
  const out = new Map();
  const inn = new Map();
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, []);
    if (!inn.has(b)) inn.set(b, []);
    out.get(a).push(b);
    inn.get(b).push(a);
  }
  const keep = new Set([start]);
  const walk = (adj) => {
    let frontier = [start];
    for (let d = 0; d < levels; d++) {
      const next = [];
      for (const n of frontier) for (const m of adj.get(n) || []) if (!keep.has(m)) {
        keep.add(m);
        next.push(m);
      }
      frontier = next;
    }
  };
  walk(out);
  walk(inn);
  return keep;
}

export function pathsOf(edges, start) {
  const up = new Set();
  const down = new Set();
  const out = new Map();
  const inn = new Map();
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, []);
    if (!inn.has(b)) inn.set(b, []);
    out.get(a).push(b);
    inn.get(b).push(a);
  }
  const fill = (adj, set) => {
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const m of adj.get(n) || []) if (!set.has(m) && m !== start) {
        set.add(m);
        queue.push(m);
      }
    }
  };
  fill(out, down);
  fill(inn, up);
  return { up, down };
}

export function impactOf(downstream, isLoaded) {
  const names = [...downstream];
  return { count: names.length, loaded: names.filter((n) => isLoaded(n)).length };
}
