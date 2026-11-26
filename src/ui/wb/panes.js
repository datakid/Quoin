import { h } from '../dom.js';

export function paneRail(glyph, label, onExpand) {
  const btn = h('button', { class: 'pane-expand', type: 'button', 'aria-label': label, title: label }, glyph);
  btn.addEventListener('click', onExpand);
  return { el: h('div', { class: 'pane-rail' }, btn), btn };
}

export function bindResizer(handle, { get, set, min, max, step = 16, grow = 1 }) {
  const apply = (w) => {
    const v = Math.max(min, Math.min(max, w));
    set(v);
    handle.setAttribute('aria-valuenow', String(Math.round(v)));
  };
  let startX = 0;
  let startW = 0;
  const move = (ev) => apply(startW + (ev.clientX - startX) * grow);
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };
  handle.addEventListener('pointerdown', (ev) => {
    startX = ev.clientX;
    startW = get();
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  handle.addEventListener('keydown', (ev) => {
    const dir = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    apply(get() + dir * grow * step);
    ev.preventDefault();
  });
}

const FOCUSABLE = 'button:not([hidden]):not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function shown(el) {
  return !!el && el.getClientRects().length > 0;
}

export class Regions {
  constructor(list) {
    this.list = list;
    this.last = new Map();
    for (const r of list) {
      r.el.addEventListener('focusin', (ev) => this.last.set(r.id, ev.target));
    }
  }

  visible() {
    return this.list.filter((r) => shown(r.el));
  }

  current() {
    const active = document.activeElement;
    return this.list.findIndex((r) => r.el.contains(active));
  }

  target(r) {
    if (r.focus) {
      const t = r.focus();
      if (t) return t;
    }
    const last = this.last.get(r.id);
    if (last && last.isConnected && shown(last)) return last;
    const first = [...r.el.querySelectorAll(FOCUSABLE)].find(shown);
    if (first) return first;
    if (!r.el.hasAttribute('tabindex')) r.el.setAttribute('tabindex', '-1');
    return r.el;
  }

  cycle(dir) {
    const vis = this.visible();
    if (!vis.length) return false;
    const now = this.current();
    const at = vis.findIndex((r) => r === this.list[now]);
    const next = at < 0 ? (dir > 0 ? 0 : vis.length - 1) : (at + dir + vis.length) % vis.length;
    const t = this.target(vis[next]);
    t.focus({ preventScroll: false });
    return true;
  }
}
