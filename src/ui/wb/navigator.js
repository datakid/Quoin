import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { menu, popover } from '../dialogs.js';
import { buildRows, chipCounts, windowOf, Selection, CHIPS, GROUPS, SORTS, parseSearch } from '../../core/wb/nav-model.js';

const PRIMARY = ['edited', 'errors', 'stale', 'never'];
const MORE = CHIPS.filter((c) => !PRIMARY.includes(c));
const OVERSCAN = 8;
const FALLBACK_ROW = 32;
const SETTLED = new Set(['ok', 'error', 'stopped', 'cancelled']);

function groupLabel(mode, key) {
  if (mode === 'folder') return key || S.nav.noFolder;
  if (mode === 'layer') return S.nav.layers[key] || key;
  if (mode === 'load') return S.nav.loads[key] || key;
  if (mode === 'status') return S.nav.states[key] || key;
  return key;
}

function paintName(el, name, ranges) {
  clear(el);
  if (!ranges.length) {
    el.textContent = name;
    return;
  }
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) el.append(name.slice(at, s));
    el.append(h('mark', { class: 'hit' }, name.slice(s, e)));
    at = e;
  }
  if (at < name.length) el.append(name.slice(at));
}

export class Navigator {
  constructor(host, src, actions) {
    this.host = host;
    this.src = src;
    this.actions = actions;
    this.group = 'folder';
    this.sort = 'section';
    this.filters = new Set();
    this.search = '';
    this.collapsed = Object.fromEntries(GROUPS.map((g) => [g, new Set()]));
    this.sel = new Selection();
    this.openKey = null;
    this.stopKey = null;
    this.rows = [];
    this.rowIndex = new Map();
    this.itemKeys = [];
    this.focusIdx = [];
    this.groupIdxs = [];
    this.queries = [];
    this.modules = [];
    this.nodes = new Map();
    this.rowH = FALLBACK_ROW;
    this.seen = new Map();
    this.ranAt = new Map();
    this.frame = 0;
    this.build();
  }

  build() {
    this.searchInput = h('input', { class: 'nav-search', type: 'search', role: 'searchbox', 'aria-label': S.nav.searchLabel, placeholder: S.nav.searchPlaceholder, autocomplete: 'off', spellcheck: false });
    this.searchInput.addEventListener('input', () => {
      this.search = this.searchInput.value;
      this.host.scrollTop = 0;
      this.refresh();
    });
    this.searchInput.addEventListener('keydown', (ev) => this.searchKey(ev));

    this.groupSelect = this.select(S.nav.group, GROUPS, S.nav.groups, this.group, (v) => {
      this.group = v;
      this.host.scrollTop = 0;
      this.refresh();
    });
    this.sortSelect = this.select(S.nav.sort, SORTS, S.nav.sorts, this.sort, (v) => {
      this.sort = v;
      this.refresh();
    });

    this.chipEls = new Map();
    this.chips = h('div', { class: 'nav-chips', role: 'group', 'aria-label': S.nav.chipsLabel });
    for (const c of CHIPS) {
      const count = h('span', { class: 'nav-chip-n' }, '0');
      const btn = h('button', { class: 'nav-chip', type: 'button', 'aria-pressed': 'false', 'data-chip': c }, h('span', null, S.nav.chips[c]), count);
      btn.hidden = !PRIMARY.includes(c);
      btn.addEventListener('click', () => this.toggleChip(c));
      this.chipEls.set(c, { btn, count });
      this.chips.append(btn);
    }
    this.moreBtn = h('button', { class: 'nav-chip nav-chip-more', type: 'button', 'aria-expanded': 'false', 'aria-label': S.nav.moreLabel }, S.nav.moreChip);
    this.moreBtn.addEventListener('click', () => this.openMore());
    this.chips.append(this.moreBtn);

    this.bar = h('div', { class: 'nav-searchbar' }, this.searchInput);
    this.controls = h('div', { class: 'nav-controls' },
      h('div', { class: 'nav-fields' }, this.groupSelect.wrap, this.sortSelect.wrap),
      this.chips);

    this.list = h('ul', { class: 'tree nav-list', role: 'tree', 'aria-label': S.queries, 'aria-multiselectable': 'true', tabindex: '-1' });
    this.list.addEventListener('keydown', (ev) => this.onKey(ev));

    this.countEl = h('span', { class: 'nav-selcount' }, '');
    this.runBtn = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.nav.runAria, onclick: () => this.runSelection(false) }, S.nav.run);
    this.downBtn = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.nav.runDownstreamAria, onclick: () => this.runSelection(true) }, S.nav.runDownstream);
    this.moreActions = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': S.nav.moreActions }, '\u22ef');
    this.moreActions.addEventListener('click', () => this.openActions(this.moreActions));
    this.clearBtn = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.nav.clearSelection, onclick: () => this.clearSelection() }, '\u00d7');
    this.selbar = h('div', { class: 'nav-selbar', role: 'toolbar', 'aria-label': S.nav.selectionLabel, hidden: true }, this.countEl, this.clearBtn, this.runBtn, this.downBtn, this.moreActions);
    this.selbar.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.clearSelection(true);
      }
    });

    this.el = h('div', { class: 'nav' }, this.bar, this.controls, this.list, this.selbar);
    this.host.prepend(this.el);
    this.host.addEventListener('scroll', () => this.scheduleRender(), { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.scheduleRender()).observe(this.host);
  }

  select(label, values, names, current, onChange) {
    const el = h('select', { class: 'nav-select', 'aria-label': label }, ...values.map((v) => h('option', { value: v }, names[v])));
    el.value = current;
    el.addEventListener('change', () => onChange(el.value));
    return { el, wrap: h('label', { class: 'nav-field' }, h('span', { class: 'nav-field-label' }, label), el) };
  }

  composeQueries() {
    const src = this.src;
    const statuses = src.statuses();
    const linked = src.linked();
    return src.queries().map((q, index) => {
      const rec = src.record(q.name);
      const status = statuses.get(q.name) || 'never';
      const sig = `${status}|${rec.rows}|${rec.durationMs}|${rec.resultId}`;
      if (this.seen.get(q.name) !== sig) {
        this.seen.set(q.name, sig);
        if (SETTLED.has(status)) this.ranAt.set(q.name, Date.now());
      }
      return {
        type: 'query',
        name: q.name,
        index,
        edited: q.edited,
        isFunction: q.isFunction,
        load: q.load,
        loadTitle: q.loadTitle,
        folder: q.folder,
        status,
        rows: rec.rows,
        durationMs: rec.durationMs,
        lastRunAt: this.ranAt.get(q.name) || 0,
        refs: q.refs,
        usedBy: q.usedBy,
        linkedToMacro: linked.has(q.name),
        get text() {
          return src.textOf({ type: 'query', name: q.name });
        },
        get steps() {
          return src.stepNames(q.name);
        }
      };
    });
  }

  composeModules() {
    const src = this.src;
    return src.modules().map((m, index) => ({
      type: 'module',
      name: m.name,
      index,
      edited: m.edited,
      get text() {
        return src.textOf({ type: 'module', name: m.name });
      }
    }));
  }

  layout() {
    const rows = [];
    const anyFolder = this.queries.some((q) => q.folder);
    const mode = this.group === 'folder' && !anyFolder ? 'none' : this.group;
    const built = buildRows(this.queries, { group: mode, sort: this.sort, filters: this.filters, search: this.search, collapsed: this.collapsed[this.group] });
    rows.push({ kind: 'label', key: 'label:queries', text: S.queries, count: this.queries.length });
    if (!built.rows.length) rows.push({ kind: 'note', key: 'note:queries', text: this.queries.length ? S.nav.none : S.noQueries });
    const groups = built.rows.filter((r) => r.kind === 'group').length;
    let groupPos = 0;
    let inGroup = 0;
    let current = null;
    for (const r of built.rows) {
      if (r.kind === 'group') {
        groupPos++;
        inGroup = 0;
        current = { ...r, level: 1, pos: groupPos, size: groups, label: groupLabel(mode, r.group), end: 0 };
        rows.push(current);
      } else {
        inGroup++;
        rows.push({ ...r, level: current ? 2 : 1, pos: inGroup, size: current ? current.count : built.rows.length });
        if (current) current.end = rows.length;
      }
    }
    for (const r of rows) if (r.kind === 'group' && r.end === 0) r.end = rows.indexOf(r) + 1;
    const hideModules = [...this.filters].some((f) => f !== 'edited');
    const modFilters = new Set([...this.filters].filter((f) => f === 'edited'));
    if (!this.modules.length) {
      rows.push({ kind: 'label', key: 'label:macros', text: S.macros, count: 0 });
      rows.push({ kind: 'note', key: 'note:macros', text: S.noMacros });
    } else {
      const mods = buildRows(hideModules ? [] : this.modules, { group: 'none', sort: 'section', filters: modFilters, search: this.search });
      if (mods.rows.length) {
        rows.push({ kind: 'label', key: 'label:macros', text: S.macros, count: this.modules.length });
        mods.rows.forEach((r, i) => rows.push({ ...r, level: 1, pos: i + 1, size: mods.rows.length }));
      }
    }
    this.rows = rows;
    this.rowIndex = new Map(rows.map((r, i) => [r.key, i]));
    this.itemKeys = rows.filter((r) => r.kind === 'item').map((r) => r.key);
    this.focusIdx = rows.map((r, i) => (r.kind === 'item' || r.kind === 'group' ? i : -1)).filter((i) => i >= 0);
    this.groupIdxs = rows.map((r, i) => (r.kind === 'group' ? i : -1)).filter((i) => i >= 0);
    this.sel.prune(this.itemKeys);
    if (!this.stopKey || !this.rowIndex.has(this.stopKey)) this.stopKey = this.openKey && this.rowIndex.has(this.openKey) ? this.openKey : this.itemKeys[0] || null;
  }

  refresh() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.queries = this.composeQueries();
    this.modules = this.composeModules();
    this.layout();
    this.paintControls();
    this.render();
    this.paintSelbar();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }

  scheduleRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  paintControls() {
    const counts = chipCounts(this.queries, this.search);
    for (const c of CHIPS) {
      const { btn, count } = this.chipEls.get(c);
      const on = this.filters.has(c);
      btn.setAttribute('aria-pressed', String(on));
      btn.hidden = !PRIMARY.includes(c) && !on;
      const text = String(counts[c]);
      if (count.textContent !== text) count.textContent = text;
    }
    if (this.groupSelect.el.value !== this.group) this.groupSelect.el.value = this.group;
    if (this.sortSelect.el.value !== this.sort) this.sortSelect.el.value = this.sort;
    this.sortSelect.el.disabled = !!this.searchActive();
  }

  searchActive() {
    return this.search.trim() && parseSearch(this.search).query !== '';
  }

  toggleChip(c) {
    if (this.filters.has(c)) this.filters.delete(c);
    else this.filters.add(c);
    this.host.scrollTop = 0;
    this.refresh();
  }

  openMore() {
    const counts = chipCounts(this.queries, this.search);
    const box = h('div', { class: 'nav-more' });
    const boxes = [];
    for (const c of MORE) {
      const input = h('input', { type: 'checkbox', checked: this.filters.has(c) });
      input.addEventListener('change', () => {
        if (input.checked) this.filters.add(c);
        else this.filters.delete(c);
        this.host.scrollTop = 0;
        this.refresh();
      });
      boxes.push(input);
      box.append(h('label', { class: 'nav-more-row' }, input, h('span', null, S.nav.chips[c]), h('span', { class: 'nav-chip-n' }, String(counts[c]))));
    }
    this.moreBtn.setAttribute('aria-expanded', 'true');
    const pop = popover(this.moreBtn, box, () => this.moreBtn.setAttribute('aria-expanded', 'false'), S.nav.moreLabel);
    if (boxes[0]) boxes[0].focus();
    return pop;
  }

  metrics() {
    const probe = this.list.querySelector('[role="treeitem"]');
    if (probe) {
      const hgt = probe.getBoundingClientRect().height;
      if (hgt > 0) this.rowH = hgt;
    }
    const total = this.host.clientHeight || Math.max(480, window.innerHeight);
    return { sticky: this.bar.offsetHeight, offset: this.list.offsetTop, bar: this.selbar.hidden ? 0 : this.selbar.offsetHeight, total };
  }

  render() {
    const m = this.metrics();
    const rowH = this.rowH;
    const top = Math.max(0, this.host.scrollTop + m.sticky - m.offset);
    const bottom = this.host.scrollTop + m.total - m.offset;
    const w = windowOf(this.rows.length, top, Math.max(rowH, bottom - top), rowH, OVERSCAN);
    this.list.style.height = `${w.total}px`;
    const first = Math.floor(top / rowH);
    let pin = -1;
    for (const g of this.groupIdxs) {
      if (g <= first) pin = g;
      else break;
    }
    if (pin >= 0 && first >= this.rows[pin].end) pin = -1;
    const want = new Set();
    for (let i = w.start; i < w.end; i++) want.add(i);
    if (pin >= 0) want.add(pin);
    const stopAt = this.rowIndex.get(this.stopKey);
    if (stopAt !== undefined) want.add(stopAt);
    const order = [...want].sort((a, b) => a - b);
    const active = document.activeElement;
    const focusedKey = active && active._navKey && this.list.contains(active) ? active._navKey : null;
    const keep = new Set();
    let prev = null;
    for (const i of order) {
      const row = this.rows[i];
      let el = this.nodes.get(row.key);
      if (!el) el = this.create(row);
      const y = i === pin ? Math.min(Math.max(i * rowH, top), (row.end - 1) * rowH) : i * rowH;
      this.paint(el, row, y, i === pin);
      keep.add(row.key);
      const ref = prev ? prev.nextSibling : this.list.firstChild;
      if (el !== ref) this.list.insertBefore(el, ref);
      prev = el;
    }
    for (const [k, el] of this.nodes) {
      if (keep.has(k)) continue;
      el.remove();
      this.nodes.delete(k);
    }
    if (focusedKey) {
      const el = this.nodes.get(focusedKey);
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
      else if (!el) this.list.focus({ preventScroll: true });
    }
  }

  create(row) {
    let el;
    if (row.kind === 'item') el = this.createItem(row);
    else if (row.kind === 'group') el = this.createGroup(row);
    else if (row.kind === 'label') el = h('li', { role: 'presentation', class: 'rail-label' }, h('span', null, ''), h('span', null, ''));
    else el = h('li', { role: 'presentation', class: 'rail-label item-meta' }, h('span', null, ''));
    el._navKey = row.key;
    this.nodes.set(row.key, el);
    return el;
  }

  createItem(row) {
    const item = row.item;
    const isQuery = item.type === 'query';
    const bead = isQuery
      ? h('span', { class: item.load && item.load.kind === 'connection' ? 'dot-conn' : 'dot-loaded' })
      : h('span', { class: 'dot-module', 'aria-hidden': 'true' });
    const name = h('span', { class: 'name' }, item.name);
    const meta = h('span', { class: 'tree-meta' });
    const tree = h('span', { class: 'tree-item' }, bead, name, isQuery && item.isFunction ? h('span', { class: 'badge-fn', 'aria-hidden': 'true' }, S.functionBadge) : null, isQuery && item.isFunction ? h('span', { class: 'sr-only' }, S.asFunction) : null, meta);
    const el = h('li', { role: 'treeitem', 'data-type': item.type, 'data-name': item.name, tabindex: '-1' }, tree);
    el._parts = { bead, name, meta, tree, edot: null, elabel: null, sig: null, metaText: null };
    el.addEventListener('click', (ev) => this.onClick(ev, el));
    el.addEventListener('contextmenu', (ev) => this.onContext(ev, el));
    el.addEventListener('focus', () => this.setStop(el._navKey));
    return el;
  }

  createGroup(row) {
    const label = h('span', { class: 'name' }, '');
    const counts = h('span', { class: 'tree-meta' }, '');
    const tree = h('span', { class: 'tree-item' }, h('span', { class: 'tree-chevron', 'aria-hidden': 'true' }), label, counts);
    const el = h('li', { role: 'treeitem', class: 'tree-folder', tabindex: '-1', 'data-group': row.group }, tree);
    el._parts = { label, counts };
    el.addEventListener('click', () => this.toggleGroup(row.key));
    el.addEventListener('focus', () => this.setStop(el._navKey));
    return el;
  }

  paint(el, row, y, pinned) {
    el.style.top = `${y}px`;
    el.style.zIndex = pinned ? '2' : '';
    if (pinned) el.dataset.pinned = 'true';
    else delete el.dataset.pinned;
    if (row.kind === 'label') {
      const [a, b] = el.children;
      if (a.textContent !== row.text) a.textContent = row.text;
      const n = String(row.count);
      if (b.textContent !== n) b.textContent = n;
      return;
    }
    if (row.kind === 'note') {
      if (el.firstChild.textContent !== row.text) el.firstChild.textContent = row.text;
      return;
    }
    const stop = row.key === this.stopKey;
    el.tabIndex = stop ? 0 : -1;
    el.setAttribute('aria-level', String(row.level));
    el.setAttribute('aria-posinset', String(row.pos));
    el.setAttribute('aria-setsize', String(row.size));
    if (row.kind === 'group') {
      const text = S.nav.groupCounts(row.count, row.statuses);
      const p = el._parts;
      if (p.label.textContent !== row.label) p.label.textContent = row.label;
      if (p.counts.textContent !== text) p.counts.textContent = text;
      el.setAttribute('aria-expanded', String(!row.collapsed));
      el.setAttribute('aria-label', S.nav.groupAria(row.label, text));
      return;
    }
    this.paintItem(el, row);
  }

  paintItem(el, row) {
    const item = row.item;
    const p = el._parts;
    el.setAttribute('aria-selected', String(this.sel.keys.has(row.key)));
    if (row.key === this.openKey) el.dataset.open = 'true';
    else delete el.dataset.open;
    const sig = row.ranges.map((r) => r.join('-')).join(',');
    if (p.sig !== sig) {
      p.sig = sig;
      paintName(p.name, item.name, row.ranges);
    }
    let meta = '';
    let title = '';
    if (row.matches) meta = S.nav.matches(row.matches);
    else if (item.type === 'query') {
      if ((item.status === 'ok' || item.status === 'stale') && item.rows !== null && item.rows !== undefined) {
        meta = String(item.rows);
        title = S.nav.rowsOf(item.rows);
      } else if (item.status === 'error' || item.status === 'stopped' || item.status === 'cancelled') meta = S.batch.state[item.status];
    }
    if (p.metaText !== meta) {
      p.metaText = meta;
      p.meta.textContent = meta;
      if (title) p.meta.title = title;
      else p.meta.removeAttribute('title');
    }
    if (item.type === 'query') {
      p.bead.dataset.status = item.status;
      p.bead.title = S.batch.state[item.status] || item.loadTitle || '';
    }
    this.paintEdited(el, item.edited);
  }

  paintEdited(el, edited) {
    const p = el._parts;
    if (edited && !p.edot) {
      p.edot = h('span', { class: 'dot-edited', 'aria-hidden': 'true' });
      p.elabel = h('span', { class: 'tree-edited' }, S.editedMark);
      p.tree.append(p.edot, p.elabel);
    } else if (!edited && p.edot) {
      p.edot.remove();
      p.elabel.remove();
      p.edot = null;
      p.elabel = null;
    }
  }

  markEdited(item, edited) {
    const list = item.type === 'query' ? this.queries : this.modules;
    const known = list.find((x) => x.name === item.name);
    if (known) known.edited = edited;
    const el = this.nodes.get(`${item.type}:${item.name}`);
    if (el && el._parts && 'edot' in el._parts) this.paintEdited(el, edited);
  }

  setStop(key) {
    if (this.stopKey === key) return;
    const old = this.nodes.get(this.stopKey);
    if (old) old.tabIndex = -1;
    this.stopKey = key;
    const next = this.nodes.get(key);
    if (next) next.tabIndex = 0;
  }

  setOpen(item) {
    const key = item ? `${item.type}:${item.name}` : null;
    this.openKey = key;
    this.sel.clear();
    if (key && this.rowIndex.has(key)) {
      this.sel.toggle(key);
      this.stopKey = key;
    }
    this.render();
    this.paintSelbar();
    if (key && this.rowIndex.has(key)) this.reveal(this.rowIndex.get(key));
  }

  reveal(i) {
    const row = this.rows[i];
    if (!row) return;
    const m = this.metrics();
    const pinned = row.kind === 'item' && this.groupIdxs.length && row.level === 2 ? this.rowH : 0;
    const top = m.offset + i * this.rowH;
    const bottom = top + this.rowH;
    const viewTop = this.host.scrollTop + m.sticky + pinned;
    const viewBottom = this.host.scrollTop + m.total - m.bar;
    if (top < viewTop) this.host.scrollTop = Math.max(0, top - m.sticky - pinned);
    else if (bottom > viewBottom) this.host.scrollTop = bottom - m.total + m.bar;
    this.render();
  }

  focusKey(key) {
    const i = this.rowIndex.get(key);
    if (i === undefined) return false;
    this.setStop(key);
    this.reveal(i);
    const el = this.nodes.get(key);
    if (el) el.focus({ preventScroll: true });
    return !!el;
  }

  focusStop() {
    if (this.stopKey && this.focusKey(this.stopKey)) return true;
    return false;
  }

  rowOf(el) {
    const i = this.rowIndex.get(el._navKey);
    return i === undefined ? null : this.rows[i];
  }

  onClick(ev, el) {
    const row = this.rowOf(el);
    if (!row || row.kind !== 'item') return;
    const mod = ev.ctrlKey || ev.metaKey;
    this.setStop(row.key);
    if (ev.shiftKey || mod) {
      this.sel.click(this.itemKeys, row.key, { shift: ev.shiftKey, ctrl: mod });
      this.afterSelection();
      return;
    }
    this.sel.click(this.itemKeys, row.key);
    this.actions.open(row.item);
  }

  onContext(ev, el) {
    const row = this.rowOf(el);
    if (!row || row.kind !== 'item') return;
    ev.preventDefault();
    if (!this.sel.keys.has(row.key)) {
      this.sel.click(this.itemKeys, row.key);
      this.afterSelection();
    }
    this.setStop(row.key);
    menu(el, this.actionEntries());
  }

  afterSelection() {
    this.render();
    this.paintSelbar();
  }

  toggleGroup(key) {
    const row = this.rows[this.rowIndex.get(key)];
    if (!row || row.kind !== 'group') return;
    const set = this.collapsed[this.group];
    if (set.has(row.group)) set.delete(row.group);
    else set.add(row.group);
    this.setStop(key);
    this.layout();
    this.render();
    this.focusKey(key);
  }

  selectedItems() {
    return this.itemKeys.filter((k) => this.sel.keys.has(k)).map((k) => this.rows[this.rowIndex.get(k)].item);
  }

  paintSelbar() {
    const items = this.selectedItems();
    const show = items.length >= 2;
    const was = !this.selbar.hidden;
    this.selbar.hidden = !show;
    if (!show) {
      if (was) this.render();
      return;
    }
    this.countEl.textContent = S.nav.selected(items.length);
    const queries = items.filter((i) => i.type === 'query');
    this.runBtn.disabled = !queries.length;
    this.downBtn.disabled = !queries.length;
    if (!was) this.render();
  }

  clearSelection(refocus) {
    const keep = this.openKey && this.rowIndex.has(this.openKey) ? this.openKey : null;
    this.sel.clear();
    if (keep) this.sel.toggle(keep);
    this.afterSelection();
    if (refocus) this.focusStop();
  }

  runSelection(downstream) {
    const names = this.selectedItems().filter((i) => i.type === 'query').map((i) => i.name);
    if (!names.length) return;
    this.actions.run(names, downstream);
  }

  actionEntries() {
    const items = this.selectedItems();
    const queries = items.filter((i) => i.type === 'query');
    const edited = items.filter((i) => i.edited);
    return [
      { label: S.nav.run, disabled: !queries.length, run: () => this.runSelection(false) },
      { label: S.nav.runDownstream, disabled: !queries.length, run: () => this.runSelection(true) },
      { label: S.nav.revert, disabled: !edited.length, run: () => this.actions.revert(edited.map((i) => ({ type: i.type, name: i.name }))) },
      { label: S.nav.showInGraph, disabled: !queries.length, run: () => this.actions.graph(queries[0].name) },
      { label: S.nav.copyNames, run: () => this.copyNames(items) }
    ];
  }

  openActions(anchor) {
    anchor.setAttribute('aria-expanded', 'true');
    menu(anchor, this.actionEntries(), () => anchor.setAttribute('aria-expanded', 'false'));
  }

  async copyNames(items) {
    const names = items.map((i) => i.name);
    let ok = false;
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      ok = true;
    } catch {
      ok = false;
    }
    this.actions.notify(ok ? S.nav.copied(names.length) : S.nav.copyFailed);
  }

  firstItemRow() {
    return this.rows.find((r) => r.kind === 'item') || null;
  }

  searchKey(ev) {
    if (ev.key === 'Escape' && this.searchInput.value) {
      ev.stopPropagation();
      this.searchInput.value = '';
      this.search = '';
      this.refresh();
    } else if (ev.key === 'ArrowDown') {
      if (this.focusStop()) ev.preventDefault();
    } else if (ev.key === 'Enter') {
      const row = this.firstItemRow();
      if (!row) return;
      ev.preventDefault();
      const parsed = parseSearch(this.search);
      this.sel.click(this.itemKeys, row.key);
      this.actions.open(row.item, parsed.mode === 'code' ? parsed.query : null);
    }
  }

  moveFocus(pos, open) {
    const at = Math.max(0, Math.min(this.focusIdx.length - 1, pos));
    const row = this.rows[this.focusIdx[at]];
    if (!row) return;
    this.focusKey(row.key);
    if (open && row.kind === 'item') {
      this.sel.click(this.itemKeys, row.key);
      this.actions.open(row.item);
    }
  }

  onKey(ev) {
    if (ev.target === this.list) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) {
        ev.preventDefault();
        this.focusStop();
      }
      return;
    }
    if (ev.key === 'Escape' && this.sel.keys.size > 1) {
      ev.preventDefault();
      ev.stopPropagation();
      this.clearSelection(false);
      return;
    }
    const el = ev.target.closest('[role="treeitem"]');
    if (!el || !el._navKey) return;
    const row = this.rowOf(el);
    if (!row) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      this.sel.selectAll(this.itemKeys);
      this.afterSelection();
      return;
    }
    const here = this.focusIdx.indexOf(this.rowIndex.get(row.key));
    const k = ev.key;
    if (mod && !ev.altKey && !ev.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) {
      ev.preventDefault();
      this.moveFocus(here + (k === 'ArrowDown' ? 1 : -1), false);
      return;
    }
    if (mod || ev.altKey) return;
    if (ev.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp') && row.kind === 'item') {
      ev.preventDefault();
      const to = this.sel.extend(this.itemKeys, row.key, k === 'ArrowDown' ? 1 : -1);
      this.afterSelection();
      this.focusKey(to);
      return;
    }
    if (k === 'ArrowDown') this.moveFocus(here + 1, true);
    else if (k === 'ArrowUp') this.moveFocus(here - 1, true);
    else if (k === 'Home') this.moveFocus(0, true);
    else if (k === 'End') this.moveFocus(this.focusIdx.length - 1, true);
    else if (k === 'Enter') {
      if (row.kind === 'group') this.toggleGroup(row.key);
      else {
        this.sel.click(this.itemKeys, row.key);
        this.actions.open(row.item);
      }
    } else if (k === ' ') {
      if (row.kind === 'group') this.toggleGroup(row.key);
      else {
        this.sel.toggle(row.key);
        this.afterSelection();
      }
    } else if (k === 'ArrowRight' && row.kind === 'group') {
      if (row.collapsed) this.toggleGroup(row.key);
      else this.moveFocus(here + 1, false);
    } else if (k === 'ArrowLeft') {
      if (row.kind === 'group' && !row.collapsed) this.toggleGroup(row.key);
      else if (row.kind === 'item' && row.level === 2) {
        const owner = [...this.groupIdxs].reverse().find((g) => g < this.rowIndex.get(row.key));
        if (owner !== undefined) this.focusKey(this.rows[owner].key);
      }
    } else if (k.length === 1 && /\S/.test(k)) {
      const key = k.toLowerCase();
      const names = this.focusIdx.map((i) => {
        const r = this.rows[i];
        return (r.kind === 'item' ? r.item.name : r.label || '').toLowerCase();
      });
      let found = -1;
      for (let n = 1; n <= names.length; n++) {
        const j = (here + n) % names.length;
        if (names[j].startsWith(key)) {
          found = j;
          break;
        }
      }
      if (found < 0) return;
      this.moveFocus(found, true);
    } else return;
    ev.preventDefault();
  }
}
