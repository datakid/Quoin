import { h, clear, svg } from '../dom.js';
import { S } from '../strings.js';
import { layoutGraph, neighbourhood, pathsOf, NODE_W, NODE_H } from '../../core/wb/graph-layout.js';

const BEAD = { ok: 'ok', error: 'error', stopped: 'stopped', cancelled: 'stopped', stale: 'stale', skipped: 'never' };
const MAX_LABEL = 20;

export function mountGraph(host, source, handlers, { start = null, runs = true } = {}) {
  const nodesAll = source.nodes();
  const edgesAll = source.edges();
  const state = { selected: start && nodesAll.includes(start) ? start : nodesAll[0] || null, all: !start, view: null, layout: null };
  const statuses = source.statuses();
  const svgEl = svg('svg', { class: 'graph-svg', role: 'application', tabindex: '0', 'aria-label': S.graph.region });
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const count = h('span', { class: 'item-meta' });
  const wrap = h('div', { class: 'graph-wrap' }, svgEl);
  const modeBtn = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
    state.all = !state.all;
    draw(true);
  } });
  const mk = (label, fn, extra) => h('button', { class: 'btn btn-quiet', type: 'button', onclick: fn, ...(extra || {}) }, label);
  const sel = h('span', { class: 'graph-selected' });
  const openBtn = mk(S.graph.open, () => act('open'));
  const runBtn = mk(S.graph.run, () => act('run'));
  const downBtn = mk(S.graph.runDownstream, () => act('runDownstream'));
  const onlyBtn = mk(S.graph.onlyThis, () => {
    state.all = false;
    draw(true);
  });
  runBtn.hidden = !runs;
  downBtn.hidden = !runs;
  const root = h('div', { class: 'graph-panel' },
    h('div', { class: 'graph-tools' }, modeBtn, mk(S.graph.fit, () => fit()), mk(S.graph.zoomOut, () => zoom(1 / 1.25)), mk(S.graph.zoomIn, () => zoom(1.25)), h('span', { class: 'spacer' }), count),
    wrap, sel, live,
    h('div', { class: 'dock-actions' }, openBtn, runBtn, downBtn, onlyBtn));

  const visible = () => {
    if (state.all || !state.selected) return new Set(nodesAll);
    return neighbourhood(edgesAll, state.selected, 2);
  };
  const act = (kind) => {
    if (!state.selected) return;
    handlers[kind](state.selected);
  };
  const setView = (v) => {
    state.view = v;
    svgEl.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  };
  const fit = () => {
    const l = state.layout;
    const pad = 24;
    const w = Math.max(l.width, NODE_W) + pad * 2;
    const hh = Math.max(l.height, NODE_H) + pad * 2;
    setView({ x: -pad, y: -pad, w, h: hh });
  };
  const zoom = (f, cx = null, cy = null) => {
    const v = state.view;
    const x = cx === null ? v.x + v.w / 2 : cx;
    const y = cy === null ? v.y + v.h / 2 : cy;
    const nw = v.w / f;
    const nh = v.h / f;
    setView({ x: x - (x - v.x) / f, y: y - (y - v.y) / f, w: nw, h: nh });
  };
  const pan = (dx, dy) => setView({ ...state.view, x: state.view.x + dx, y: state.view.y + dy });
  const reveal = () => {
    const p = state.layout.nodes.get(state.selected);
    if (!p) return;
    const v = state.view;
    let { x, y } = v;
    if (p.x < v.x + 8) x = p.x - 24;
    if (p.x + NODE_W > v.x + v.w - 8) x = p.x + NODE_W + 24 - v.w;
    if (p.y < v.y + 8) y = p.y - 24;
    if (p.y + NODE_H > v.y + v.h - 8) y = p.y + NODE_H + 24 - v.h;
    if (x !== v.x || y !== v.y) setView({ ...v, x, y });
  };
  const draw = (refit) => {
    const keep = visible();
    const names = nodesAll.filter((n) => keep.has(n));
    const edges = edgesAll.filter(([a, b]) => keep.has(a) && keep.has(b));
    state.layout = layoutGraph(names, edges);
    const paths = state.selected ? pathsOf(edgesAll, state.selected) : { up: new Set(), down: new Set() };
    clear(svgEl);
    if (!names.length) {
      svgEl.append(svg('text', { x: 8, y: 20, class: 'graph-empty' }, S.graph.empty));
    }
    const edgeLayer = svg('g', { class: 'graph-edges' });
    for (const e of state.layout.edges) {
      const on = state.selected && ((e.from === state.selected && paths.down.has(e.to)) || (e.to === state.selected && paths.up.has(e.from)) || (paths.up.has(e.from) && (paths.up.has(e.to) || e.to === state.selected)) || (paths.down.has(e.to) && (paths.down.has(e.from) || e.from === state.selected)));
      edgeLayer.append(svg('path', { d: e.path, class: `graph-edge${e.cyclic ? ' is-cycle' : ''}${on ? ' is-on' : ''}`, fill: 'none' }));
    }
    svgEl.append(edgeLayer);
    for (const [name, p] of state.layout.nodes) {
      const cls = `graph-node${name === state.selected ? ' is-selected' : ''}${paths.up.has(name) ? ' is-up' : ''}${paths.down.has(name) ? ' is-down' : ''}`;
      const label = name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}\u2026` : name;
      const st = BEAD[statuses.get(name)] || 'never';
      svgEl.append(svg('g', { class: cls, transform: `translate(${p.x} ${p.y})`, 'data-name': name, onclick: () => select(name), ondblclick: () => {
        select(name);
        act('open');
      } },
      svg('title', null, name),
      svg('rect', { width: NODE_W, height: NODE_H, rx: 10 }),
      svg('circle', { cx: 14, cy: NODE_H / 2, r: 4, class: `graph-bead bead-${st}` }),
      svg('text', { x: 26, y: NODE_H / 2 + 4 }, label)));
    }
    modeBtn.textContent = state.all ? S.graph.neighbourhood : S.graph.all;
    count.textContent = S.graph.count(names.length);
    const dis = !state.selected;
    for (const b of [openBtn, runBtn, downBtn, onlyBtn]) b.disabled = dis;
    onlyBtn.hidden = !state.all;
    sel.textContent = state.selected ? S.graph.selected(state.selected, source.upstream(state.selected), source.downstream(state.selected)) : '';
    if (refit || !state.view) fit();
    else reveal();
  };
  const select = (name) => {
    state.selected = name;
    live.textContent = S.graph.selected(name, source.upstream(name), source.downstream(name));
    draw(false);
    if (!state.layout.nodes.has(name)) draw(true);
  };
  const move = (dir) => {
    const cur = state.selected;
    if (!cur) return;
    const p = state.layout.nodes.get(cur);
    if (!p) return;
    let next = null;
    if (dir === 'left') next = state.layout.edges.filter((e) => e.to === cur).map((e) => e.from)[0];
    else if (dir === 'right') next = state.layout.edges.filter((e) => e.from === cur).map((e) => e.to)[0];
    else {
      const col = state.layout.layers[p.layer];
      const at = col.indexOf(cur) + (dir === 'down' ? 1 : -1);
      next = col[at];
    }
    if (next) select(next);
  };
  svgEl.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k === 'Enter') {
      ev.preventDefault();
      act('open');
    } else if (ev.shiftKey && k.startsWith('Arrow')) {
      ev.preventDefault();
      const d = 80;
      pan(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    } else if (k === 'ArrowLeft') {
      ev.preventDefault();
      move('left');
    } else if (k === 'ArrowRight') {
      ev.preventDefault();
      move('right');
    } else if (k === 'ArrowUp') {
      ev.preventDefault();
      move('up');
    } else if (k === 'ArrowDown') {
      ev.preventDefault();
      move('down');
    } else if (k === '+' || k === '=') zoom(1.25);
    else if (k === '-') zoom(1 / 1.25);
    else if (k === '0') fit();
  });
  svgEl.addEventListener('wheel', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const r = svgEl.getBoundingClientRect();
    const v = state.view;
    zoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1, v.x + ((ev.clientX - r.left) / r.width) * v.w, v.y + ((ev.clientY - r.top) / r.height) * v.h);
  }, { passive: false });
  let drag = null;
  svgEl.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest && ev.target.closest('.graph-node')) return;
    drag = { x: ev.clientX, y: ev.clientY };
    svgEl.setPointerCapture(ev.pointerId);
  });
  svgEl.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const r = svgEl.getBoundingClientRect();
    pan(-((ev.clientX - drag.x) / r.width) * state.view.w, -((ev.clientY - drag.y) / r.height) * state.view.h);
    drag = { x: ev.clientX, y: ev.clientY };
  });
  svgEl.addEventListener('pointerup', () => {
    drag = null;
  });
  clear(host);
  host.append(root);
  draw(true);
  if (state.selected) live.textContent = S.graph.selected(state.selected, source.upstream(state.selected), source.downstream(state.selected));
  return { root, focus: () => svgEl.focus() };
}
