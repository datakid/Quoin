import { h } from '../dom.js';
import { S } from '../strings.js';

export const DOCK_TABS = ['result', 'pinned', 'compare', 'problems', 'queue', 'graph', 'changes'];

export class Dock {
  constructor({ onShow }) {
    this.onShow = onShow;
    this.current = 'result';
    this.tabs = h('div', { class: 'dock-tabs', role: 'tablist', 'aria-label': S.dock.label });
    this.body = h('div', { class: 'dock-body' });
    this.buttons = new Map();
    this.counts = new Map();
    this.panels = new Map();
    for (const id of DOCK_TABS) {
      const count = h('span', { class: 'dock-count', hidden: true });
      const btn = h('button', { class: 'dock-tab', type: 'button', role: 'tab', id: `dock-tab-${id}`, 'aria-controls': `dock-panel-${id}`, 'aria-selected': String(id === 'result'), tabindex: id === 'result' ? '0' : '-1', 'data-tab': id }, S.dock.tabs[id], count);
      btn.addEventListener('click', () => this.show(id));
      this.tabs.append(btn);
      this.buttons.set(id, btn);
      this.counts.set(id, count);
      const panel = h('div', { class: 'dock-panel', role: 'tabpanel', id: `dock-panel-${id}`, 'aria-labelledby': `dock-tab-${id}`, 'data-panel': id, hidden: id !== 'result' });
      this.body.append(panel);
      this.panels.set(id, panel);
    }
    this.tabs.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  panel(id) {
    return this.panels.get(id);
  }

  badge(id, text) {
    const el = this.counts.get(id);
    const t = text === null || text === undefined || text === '' ? '' : String(text);
    el.textContent = t;
    el.hidden = !t;
  }

  show(id, { focus = false } = {}) {
    if (!this.panels.has(id)) return false;
    this.current = id;
    for (const [k, btn] of this.buttons) {
      const on = k === id;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      this.panels.get(k).hidden = !on;
    }
    if (this.onShow) this.onShow(id);
    if (focus) this.buttons.get(id).focus();
    return true;
  }

  onKey(ev) {
    const target = ev.target.closest('.dock-tab');
    if (!target) return;
    const at = DOCK_TABS.indexOf(target.dataset.tab);
    let next = at;
    if (ev.key === 'ArrowRight') next = (at + 1) % DOCK_TABS.length;
    else if (ev.key === 'ArrowLeft') next = (at - 1 + DOCK_TABS.length) % DOCK_TABS.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = DOCK_TABS.length - 1;
    else return;
    ev.preventDefault();
    this.show(DOCK_TABS[next], { focus: true });
  }
}
