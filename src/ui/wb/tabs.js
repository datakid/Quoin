import { h } from '../dom.js';
import { S } from '../strings.js';

export class TabStrip {
  constructor(label, actions) {
    this.actions = actions;
    this.nodes = new Map();
    this.el = h('div', { class: 'tabstrip', role: 'tablist', 'aria-label': label });
    this.el.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  setLabel(label) {
    this.el.setAttribute('aria-label', label);
  }

  create(tab) {
    const bead = h('span', { class: tab.item.type === 'module' ? 'tab-bead tab-bead-module' : 'tab-bead', 'aria-hidden': 'true' });
    const name = h('span', { class: 'tab-name' }, tab.item.name);
    const state = h('span', { class: 'sr-only' }, '');
    const edited = h('span', { class: 'tab-edited', 'aria-hidden': 'true', hidden: true });
    const main = h('button', { class: 'tab-main', type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1', title: tab.item.name }, bead, name, edited, state);
    const close = h('button', { class: 'tab-close', type: 'button', tabindex: '-1', 'aria-label': S.tabs.close(tab.item.name) }, '\u00d7');
    const wrap = h('div', { class: 'tab', role: 'presentation', draggable: true, 'data-key': tab.key }, main, close);
    wrap._parts = { bead, name, state, edited, main, close };
    main.addEventListener('click', () => this.actions.activate(tab.key));
    main.addEventListener('dblclick', () => this.actions.permanent(tab.key));
    main.addEventListener('auxclick', (ev) => {
      if (ev.button === 1) {
        ev.preventDefault();
        this.actions.close(tab.key);
      }
    });
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.actions.close(tab.key);
    });
    wrap.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.actions.menu(tab.key, main);
    });
    wrap.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', tab.key);
      ev.dataTransfer.effectAllowed = 'move';
      this.actions.dragStart(tab.key);
    });
    wrap.addEventListener('dragend', () => this.actions.dragEnd());
    return wrap;
  }

  set(tabs, activeKey, infoOf, onlyTab) {
    const keep = new Set();
    let prev = null;
    for (const tab of tabs) {
      let el = this.nodes.get(tab.key);
      if (!el) {
        el = this.create(tab);
        this.nodes.set(tab.key, el);
      }
      keep.add(tab.key);
      const info = infoOf(tab);
      const p = el._parts;
      const active = tab.key === activeKey;
      p.main.setAttribute('aria-selected', String(active));
      p.main.tabIndex = active ? 0 : -1;
      el.dataset.preview = tab.preview ? 'true' : 'false';
      if (info.status) p.bead.dataset.status = info.status;
      else delete p.bead.dataset.status;
      p.edited.hidden = !info.edited;
      const state = [tab.preview ? S.tabs.previewState : '', info.edited ? S.tabs.editedState : ''].filter(Boolean).join(', ');
      if (p.state.textContent !== state) p.state.textContent = state;
      p.close.hidden = !!onlyTab;
      const ref = prev ? prev.nextSibling : this.el.firstChild;
      if (el !== ref) this.el.insertBefore(el, ref);
      prev = el;
    }
    for (const [k, el] of this.nodes) {
      if (keep.has(k)) continue;
      el.remove();
      this.nodes.delete(k);
    }
  }

  mains() {
    return [...this.el.querySelectorAll('.tab-main')];
  }

  onKey(ev) {
    const target = ev.target.closest('.tab-main');
    if (!target) return;
    const all = this.mains();
    const at = all.indexOf(target);
    const key = target.parentElement.dataset.key;
    const go = (i) => {
      const next = all[(i + all.length) % all.length];
      if (next) {
        for (const m of all) m.tabIndex = m === next ? 0 : -1;
        next.focus();
      }
    };
    if (ev.key === 'ArrowRight') go(at + 1);
    else if (ev.key === 'ArrowLeft') go(at - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(all.length - 1);
    else if (ev.key === 'Delete') this.actions.close(key);
    else return;
    ev.preventDefault();
  }
}
