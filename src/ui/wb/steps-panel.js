import { h, clear, placeBelow } from '../dom.js';
import { S, fmt } from '../strings.js';
import { menu, popover } from '../dialogs.js';
import { matches } from '../../app/commands.js';
import { shapeOf, stepDelta, rowsCountable } from '../../core/wb/step-delta.js';

export function deltaParts(d) {
  if (!d) return [];
  if (d.type === 'rows') return [d.rows === null ? S.stepsPanel.rowsNotCounted : S.stepsPanel.rows(d.rows)];
  if (d.type === 'same') return [S.stepsPanel.d.same];
  if (d.type === 'kind') return [d.kind === 'list' ? S.stepsPanel.d.list(d.count) : S.stepsPanel.d.kinds[d.kind] || d.kind];
  return d.parts.map((p) => S.stepsPanel.d[p.k](p.n));
}

const PEEK_DELAY = 400;
const PEEK_ROWS = 5;

function peekText(c) {
  if (c === null || c === undefined) return S.colTools.nullLabel;
  if (typeof c === 'string') return c;
  if (typeof c === 'number' || typeof c === 'boolean') return String(c);
  if (c.k === 'number') return c.special;
  return c.text !== undefined ? c.text : c.k || '';
}

const KEYS = { rename: 'F2', del: 'Delete', bypass: 'b', up: 'Alt+Shift+ArrowUp', down: 'Alt+Shift+ArrowDown', runTo: 'Mod+F10', dup: 'Mod+D', insert: 'Insert' };

export class StepsPanel {
  constructor(host, actions) {
    this.actions = actions;
    this.title = h('span', { class: 'panel-title' }, S.stepsPanel.title);
    this.count = h('span', { class: 'count-pill' }, '0');
    this.runBtn = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => actions.runSteps() }, S.stepsPanel.runSteps);
    this.undoBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => actions.undo() }, S.stepsPanel.undo);
    this.historyBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, 'aria-haspopup': 'dialog', onclick: (ev) => this.openHistory(ev.currentTarget) }, S.stepsPanel.history);
    this.undoTimer = null;
    this.head = h('div', { class: 'panel-head' }, this.title, this.count, h('span', { class: 'spacer' }), this.undoBtn, this.historyBtn, this.runBtn);
    this.list = h('ol', { class: 'steps-list', role: 'list', 'aria-label': S.stepsPanel.aria });
    this.note = h('p', { class: 'panel-note item-meta', hidden: true });
    this.refreshed = h('p', { class: 'panel-note item-meta refreshed-by', hidden: true });
    this.live = h('div', { class: 'sr-only steps-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
    host.append(this.head, this.note, this.refreshed, this.list, this.live);
    this.model = null;
    this.results = new Map();
    this.caret = null;
    this.focusName = null;
    this.list.addEventListener('keydown', (ev) => this.onKey(ev));
    this.dropNote = h('p', { class: 'panel-note item-meta step-drop-note', hidden: true, role: 'status' });
    host.append(this.dropNote);
    this.countOptions = { countRows: true, limit: 2000000 };
    this.peekEl = null;
    this.peekTimer = null;
    this.peekFor = null;
    this.list.addEventListener('mouseover', (ev) => this.schedulePeek(ev.target.closest && ev.target.closest('.step-row')));
    this.list.addEventListener('focusin', (ev) => this.schedulePeek(ev.target.closest && ev.target.closest('.step-row')));
    this.list.addEventListener('mouseleave', () => this.hidePeek());
    this.list.addEventListener('focusout', (ev) => {
      if (!this.list.contains(ev.relatedTarget)) this.hidePeek();
    });
    this.list.addEventListener('click', () => this.hidePeek());
    this.list.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.hidePeek();
    });
    this.drag = null;
    this.dropTo = null;
    this.list.addEventListener('dragover', (ev) => this.onDragOver(ev));
    this.list.addEventListener('drop', (ev) => this.onDrop(ev));
    this.list.addEventListener('dragleave', (ev) => {
      if (!this.list.contains(ev.relatedTarget)) this.clearDrop();
    });
  }

  setCountOptions(o) {
    this.countOptions = { countRows: o.countRows !== false, limit: o.limit };
  }

  schedulePeek(row) {
    if (!row || !this.model) {
      this.hidePeek();
      return;
    }
    const st = this.stepAt(row);
    if (this.peekFor === st.name && this.peekEl) return;
    this.hidePeek();
    this.peekFor = st.name;
    this.peekTimer = setTimeout(() => this.showPeek(row, st), PEEK_DELAY);
  }

  showPeek(row, st) {
    const r = this.results.get(st.name);
    if (!r || r.status !== 'ok' || !r.result || r.result.kind !== 'table' || !row.isConnected) return;
    const t = r.result.value;
    const shown = t.rows.slice(0, PEEK_ROWS);
    const more = t.rowCount - shown.length;
    const id = `peek-${Date.now()}`;
    const table = h('table', { class: 'peek-table' },
      h('thead', null, h('tr', null, ...t.columns.map((c) => h('th', { scope: 'col' }, c.name, h('span', { class: 'peek-type' }, c.type))))),
      h('tbody', null, ...shown.map((cells) => h('tr', null, ...cells.map((c) => h('td', null, peekText(c)))))));
    this.peekEl = h('div', { class: 'step-peek', role: 'tooltip', id },
      h('div', { class: 'peek-title' }, S.stepsPanel.peekTitle(st.name)),
      shown.length ? table : h('p', { class: 'item-meta' }, S.stepsPanel.peekNoRows),
      more > 0 ? h('p', { class: 'item-meta' }, S.stepsPanel.peekMore(more)) : null);
    placeBelow(this.peekEl, row, 'right');
    row.setAttribute('aria-describedby', id);
    this.peekRow = row;
  }

  hidePeek() {
    clearTimeout(this.peekTimer);
    this.peekTimer = null;
    this.peekFor = null;
    if (this.peekRow) this.peekRow.removeAttribute('aria-describedby');
    this.peekRow = null;
    if (this.peekEl) this.peekEl.remove();
    this.peekEl = null;
  }

  showUndo(label, ms = 10000) {
    clearTimeout(this.undoTimer);
    this.undoBtn.hidden = false;
    this.undoBtn.setAttribute('aria-label', S.stepsPanel.undoLabel(label));
    this.undoTimer = setTimeout(() => this.hideUndo(), ms);
  }

  setHistorySize(n) {
    this.historyBtn.hidden = !n;
  }

  hideUndo() {
    clearTimeout(this.undoTimer);
    this.undoBtn.hidden = true;
  }

  openHistory(anchor) {
    const versions = this.actions.versions();
    const body = h('div', { class: 'history-pop' }, h('h3', null, S.stepsPanel.historyTitle));
    const list = h('ol', { class: 'history-list' });
    versions.forEach((v) => {
      const label = v.label === null ? S.stepsPanel.historyOriginal : v.label;
      list.append(h('li', null,
        h('span', { class: 'history-label' }, label),
        h('span', { class: 'history-time item-meta' }, new Date(v.at).toLocaleTimeString()),
        h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.stepsPanel.restoreFor(label), onclick: () => {
          pop.close();
          this.actions.restore(v);
        } }, S.stepsPanel.restore)));
    });
    body.append(list);
    const pop = popover(anchor, body, null, S.stepsPanel.historyTitle);
    const first = pop.el.querySelector('button');
    if (first) first.focus();
  }

  renderInvoke({ params, values, onInvoke }) {
    clear(this.list);
    this.count.textContent = String(params.length);
    this.results = new Map();
    this.caret = null;
    this.note.hidden = true;
    this.refreshed.hidden = true;
    this.dropNote.hidden = true;
    if (!params.length) {
      this.note.hidden = false;
      this.note.textContent = S.stepsPanel.fn;
      return;
    }
    const inputs = new Map();
    for (const p of params) {
      const input = h('input', { class: 'invoke-input', type: p.type && p.type.name === 'number' ? 'number' : 'text', value: values[p.name] === undefined ? '' : String(values[p.name]) });
      input.setAttribute('aria-label', p.optional ? `${p.name} (${S.stepsPanel.invokeOptional})` : p.name);
      inputs.set(p.name, input);
    }
    const run = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => onInvoke(Object.fromEntries([...inputs].map(([n, i]) => [n, i.value]))) }, S.stepsPanel.invokeRun);
    this.list.append(h('li', { class: 'step-item invoke-item' },
      h('div', { class: 'outline-label' }, S.stepsPanel.invokeTitle),
      ...params.map((p) => h('label', { class: 'invoke-row' }, h('span', { class: 'invoke-name' }, p.name), inputs.get(p.name))),
      h('div', { class: 'dialog-actions' }, run)));
  }

  announce(text) {
    this.live.textContent = '';
    this.live.textContent = text;
  }

  setRefreshedBy(list) {
    this.refreshed.hidden = !list || !list.length;
    this.refreshed.textContent = list && list.length ? `${S.pqLinks.refreshedBy}: ${list.join(', ')}` : '';
  }

  setResults(results) {
    this.results = results || new Map();
  }

  render(model, caretName = null) {
    this.model = model;
    this.caret = caretName;
    this.hidePeek();
    clear(this.list);
    const shape = model ? model.shape : 'invalid';
    this.runBtn.hidden = shape !== 'let';
    this.count.textContent = String(model && model.steps ? model.steps.length : 0);
    const note = shape === 'function' || shape === 'function-let' ? S.stepsPanel.fn : shape === 'invalid' ? S.stepsPanel.invalid : shape === 'expression' ? S.stepsPanel.notEditable : null;
    this.note.hidden = !note;
    this.note.textContent = note || '';
    if (shape !== 'let' && shape !== 'function-let') return;
    if (!model.steps.length) {
      this.note.hidden = false;
      this.note.textContent = S.stepsPanel.empty;
      return;
    }
    const editable = shape === 'let';
    let prevRows = null;
    let prevShape = null;
    model.steps.forEach((st, i) => {
      const r = this.results.get(st.name);
      const bead = h('span', { class: `bead bead-${r ? r.status : 'never'}`, role: 'img', 'aria-label': S.stepsPanel.status[r ? r.status : 'never'] });
      const shape = r && r.status === 'ok' ? shapeOf(r.result) : null;
      if (shape && shape.kind === 'table' && !rowsCountable(shape.rows, this.countOptions)) shape.rows = null;
      let all = [];
      if (shape) all = deltaParts(stepDelta(prevShape, shape));
      else if (r && r.status === 'ok' && r.rowCount !== undefined && rowsCountable(r.rowCount, this.countOptions)) all = [prevRows !== null && prevRows !== r.rowCount ? S.stepsPanel.delta(r.rowCount - prevRows) : S.stepsPanel.rows(r.rowCount)];
      const delta = all.length ? all.slice(0, 2).join(' \u00b7 ') : null;
      if (shape && shape.kind === 'table') prevShape = shape;
      if (r && r.status === 'ok' && r.rowCount !== undefined) prevRows = r.rowCount;
      const warn = st.forward.length ? h('span', { class: 'step-warn', title: S.stepsPanel.forward(st.forward[0]) }, '!') : null;
      const row = h('button', { class: `step-row${st.bypassed ? ' is-bypassed' : ''}${st.name === caretName ? ' is-current' : ''}`, type: 'button', 'data-index': String(i), tabindex: st.name === (this.focusName || caretName || model.steps[0].name) ? '0' : '-1', 'aria-current': st.name === caretName ? 'true' : null, onclick: () => this.actions.go(st) },
        bead,
        h('span', { class: 'step-name' }, st.name),
        st.bypassed ? h('span', { class: 'step-tag' }, S.stepsPanel.bypassed) : null,
        h('span', { class: 'step-kind' }, S.stepKind[st.kind] || S.stepKind.custom),
        delta ? h('span', { class: 'step-delta item-meta', title: all.length > 2 ? all.join(' \u00b7 ') : null }, delta) : null,
        warn);
      const more = editable ? h('button', { class: 'btn btn-quiet step-more', type: 'button', 'aria-label': `${S.stepsPanel.menu} ${st.name}`, 'aria-haspopup': 'menu', onclick: (ev) => this.openMenu(ev.currentTarget, st) }, '\u22ef') : null;
      const grip = editable ? h('span', { class: 'step-grip', 'aria-hidden': 'true', title: S.stepsPanel.grip }, '\u22ee\u22ee') : null;
      const li = h('li', { class: 'step-item', draggable: editable }, grip, row, more);
      if (editable) {
        li.addEventListener('dragstart', (ev) => {
          this.drag = st;
          ev.dataTransfer.setData('text/plain', st.name);
          ev.dataTransfer.effectAllowed = 'move';
          li.classList.add('is-dragging');
        });
        li.addEventListener('dragend', () => this.endDrag(li));
      }
      this.list.append(li);
    });
  }

  rows() {
    return [...this.list.querySelectorAll('.step-row')];
  }

  focusStep(name) {
    this.focusName = name;
    const row = this.rows().find((r) => r.querySelector('.step-name').textContent === name);
    for (const r of this.rows()) r.tabIndex = r === row ? 0 : -1;
    if (row) row.focus();
  }

  stepAt(row) {
    return this.model.steps[Number(row.dataset.index)];
  }

  onKey(ev) {
    const row = ev.target.closest && ev.target.closest('.step-row');
    if (!row || !this.model) return;
    const st = this.stepAt(row);
    const rows = this.rows();
    const at = rows.indexOf(row);
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      this.actions.undo();
    } else if (matches(ev, KEYS.up)) {
      ev.preventDefault();
      this.actions.move(st, st.index - 1);
    } else if (matches(ev, KEYS.down)) {
      ev.preventDefault();
      this.actions.move(st, st.index + 1);
    } else if (ev.key === 'ArrowDown' && !ev.altKey) {
      ev.preventDefault();
      if (rows[at + 1]) this.focusStep(this.stepAt(rows[at + 1]).name);
    } else if (ev.key === 'ArrowUp' && !ev.altKey) {
      ev.preventDefault();
      if (rows[at - 1]) this.focusStep(this.stepAt(rows[at - 1]).name);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      this.focusStep(this.stepAt(rows[0]).name);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      this.focusStep(this.stepAt(rows[rows.length - 1]).name);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.actions.go(st);
    } else if (matches(ev, KEYS.rename)) {
      ev.preventDefault();
      this.startRename(row, st);
    } else if (matches(ev, KEYS.del)) {
      ev.preventDefault();
      this.actions.del(st);
    } else if (ev.key.toLowerCase() === 'b' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      this.actions.bypass(st);
    } else if (matches(ev, KEYS.dup)) {
      ev.preventDefault();
      this.actions.duplicate(st);
    } else if (matches(ev, KEYS.runTo)) {
      ev.preventDefault();
      this.actions.runTo(st);
    } else if (matches(ev, KEYS.insert)) {
      ev.preventDefault();
      this.startInsert(row, st);
    } else if (ev.key.toLowerCase() === 'j' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      this.actions.cursor(1, st.name);
    } else if (ev.key.toLowerCase() === 'k' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      this.actions.cursor(-1, st.name);
    }
  }

  clearDrop() {
    for (const el of this.list.querySelectorAll('.drop-before, .drop-after, .drop-ok, .drop-bad')) el.classList.remove('drop-before', 'drop-after', 'drop-ok', 'drop-bad');
    this.dropNote.hidden = true;
    this.dropTo = null;
  }

  endDrag(li) {
    if (li) li.classList.remove('is-dragging');
    this.drag = null;
    this.clearDrop();
  }

  onDragOver(ev) {
    if (!this.drag) return;
    const li = ev.target.closest && ev.target.closest('.step-item');
    if (!li) return;
    const rect = li.getBoundingClientRect();
    const after = ev.clientY > rect.top + rect.height / 2;
    const i = Number(li.querySelector('.step-row').dataset.index);
    const gap = after ? i + 1 : i;
    const from = this.drag.index;
    const to = gap > from ? gap - 1 : gap;
    const can = this.actions.can(this.drag, to);
    this.clearDrop();
    li.classList.add(after ? 'drop-after' : 'drop-before', can.ok ? 'drop-ok' : 'drop-bad');
    if (can.ok) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      this.dropTo = to;
    } else {
      ev.dataTransfer.dropEffect = 'none';
      this.dropNote.hidden = false;
      this.dropNote.textContent = S.stepsPanel.dropNote(this.drag.name, can.reason);
    }
  }

  onDrop(ev) {
    if (!this.drag) return;
    ev.preventDefault();
    const st = this.drag;
    const to = this.dropTo;
    this.endDrag();
    if (to !== null && to !== undefined) this.actions.move(st, to);
  }

  startInsert(row, st) {
    const names = new Set(this.model.steps.map((x) => x.name));
    let n = this.model.steps.length + 1;
    while (names.has(`Step${n}`)) n++;
    const nameIn = h('input', { class: 'step-rename', type: 'text', value: `Step${n}`, 'aria-label': S.stepsPanel.insertName });
    const exprIn = h('input', { class: 'step-rename step-expr', type: 'text', value: this.actions.ref(st), 'aria-label': S.stepsPanel.insertExpr, spellcheck: false });
    const apply = h('button', { class: 'btn btn-quiet', type: 'button' }, S.stepsPanel.insertApply);
    const cancel = h('button', { class: 'btn btn-quiet', type: 'button' }, S.stepsPanel.cancel);
    const form = h('li', { class: 'step-insert' }, nameIn, exprIn, h('span', { class: 'step-insert-actions' }, apply, cancel));
    row.closest('.step-item').after(form);
    nameIn.focus();
    nameIn.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = nameIn.value.trim();
      const expr = exprIn.value.trim();
      form.remove();
      if (commit && name && expr) this.actions.insert(st, name, expr);
      else row.focus();
    };
    const key = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    nameIn.addEventListener('keydown', key);
    exprIn.addEventListener('keydown', key);
    apply.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
  }

  startRename(row, st) {
    const input = h('input', { class: 'step-rename', type: 'text', value: st.name, 'aria-label': S.stepsPanel.renameLabel });
    row.hidden = true;
    row.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      row.hidden = false;
      if (commit && value && value !== st.name) this.actions.rename(st, value);
      else row.focus();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  pinnable(st) {
    const r = this.results.get(st.name);
    return !!(r && r.status === 'ok' && r.resultId && r.result && r.result.kind === 'table');
  }

  openMenu(anchor, st) {
    const n = this.model.steps.length;
    const entries = [
      { label: S.stepsPanel.moveUp, run: () => this.actions.move(st, st.index - 1), disabled: st.index === 0 },
      { label: S.stepsPanel.moveDown, run: () => this.actions.move(st, st.index + 1), disabled: st.index === n - 1 },
      { label: S.stepsPanel.rename, run: () => this.startRename(this.rows()[st.index], st) },
      { label: S.stepsPanel.insert, run: () => this.startInsert(this.rows()[st.index], st) },
      { label: S.stepsPanel.duplicate, run: () => this.actions.duplicate(st) },
      { label: st.bypassed ? S.stepsPanel.restore : S.stepsPanel.bypass, run: () => this.actions.bypass(st), disabled: st.index === 0 },
      { label: S.stepsPanel.runTo, run: () => this.actions.runTo(st) },
      { label: S.stepsPanel.pin, run: () => this.actions.pin(st), disabled: !this.pinnable(st) },
      { label: S.stepsPanel.del, run: () => this.actions.del(st), disabled: n === 1 }
    ];
    menu(anchor, entries, () => anchor.focus());
  }
}

export { fmt };
