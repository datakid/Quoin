import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { findInItemsAsync, previewReplacement, applyReplacements, buildRegex } from '../../core/wb/find.js';
import { openDialog } from '../dialogs.js';

function highlighted(text, col, len) {
  const at = col - 1;
  return [text.slice(0, at), h('mark', null, text.slice(at, at + len)), text.slice(at + len)];
}

export function openFind(source, handlers, { replace = false, initial = '' } = {}) {
  const state = { results: [], token: 0, selected: new Set(), busy: false };
  const idp = `fd-${Math.random().toString(36).slice(2, 7)}`;
  const find = h('input', { id: `${idp}-find`, type: 'text', class: 'find-input', value: initial, autocomplete: 'off', spellcheck: 'false' });
  const repl = h('input', { id: `${idp}-repl`, type: 'text', class: 'find-input', autocomplete: 'off', spellcheck: 'false' });
  const box = (label, id) => {
    const cb = h('input', { type: 'checkbox', id: `${idp}-${id}` });
    cb.addEventListener('change', () => run());
    return [cb, h('label', { for: `${idp}-${id}`, class: 'check' }, label)];
  };
  const [cCase, lCase] = box(S.find.matchCase, 'case');
  const [cWord, lWord] = box(S.find.wholeWord, 'word');
  const [cRe, lRe] = box(S.find.regex, 're');
  const [cCode, lCode] = box(S.find.codeOnly, 'code');
  const scope = h('select', { id: `${idp}-scope` }, ...Object.entries(S.find.scopes).map(([v, l]) => h('option', { value: v }, l)));
  scope.addEventListener('change', () => run());
  const error = h('div', { class: 'find-error', role: 'alert' });
  const status = h('div', { class: 'find-status item-meta', role: 'status', 'aria-live': 'polite' });
  const list = h('div', { class: 'find-results' });
  const applyBtn = h('button', { class: 'btn btn-primary', type: 'button', hidden: !replace, onclick: () => apply() }, S.find.replaceSelected(0));
  const allBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: !replace, onclick: () => selectAll(true) }, S.find.selectAll);
  const noneBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: !replace, onclick: () => selectAll(false) }, S.find.selectNone);
  const close = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, S.close);
  const dlg = h('dialog', { class: 'find', 'aria-labelledby': `${idp}-title` },
    h('h2', { id: `${idp}-title` }, replace ? S.find.replaceTitle : S.find.findTitle),
    h('div', { class: 'find-fields' }, h('label', { for: `${idp}-find` }, S.find.findLabel), find, replace ? h('label', { for: `${idp}-repl` }, S.find.replaceLabel) : null, replace ? repl : null, h('label', { for: `${idp}-scope` }, S.find.scope), scope),
    h('div', { class: 'find-options' }, cCase, lCase, cWord, lWord, cRe, lRe, cCode, lCode),
    error, status, list,
    h('div', { class: 'dialog-actions' }, allBtn, noneBtn, h('span', { class: 'spacer' }), applyBtn, close));

  const opts = () => ({ query: find.value, matchCase: cCase.checked, wholeWord: cWord.checked, regex: cRe.checked, codeOnly: cCode.checked, scope: scope.value });
  const key = (r, m) => `${r.item.type}:${r.item.name}:${m.start}`;
  const updateApply = () => {
    applyBtn.textContent = S.find.replaceSelected(state.selected.size);
    applyBtn.disabled = state.selected.size === 0;
  };
  const selectAll = (on) => {
    state.selected.clear();
    if (on) for (const r of state.results) if (!r.skipped) for (const m of r.matches) state.selected.add(key(r, m));
    paint();
  };
  const paint = () => {
    clear(list);
    const template = repl.value;
    for (const r of state.results) {
      const head = h('div', { class: 'find-group' }, h('span', { class: 'find-item' }, r.item.name), h('span', { class: 'count-pill' }, String(r.matches.length)), r.skipped ? h('span', { class: 'item-meta' }, S.find.skipped(r.skipped)) : null);
      const rows = r.matches.map((m) => {
        const k = key(r, m);
        const cb = replace && !r.skipped ? h('input', { type: 'checkbox', 'aria-label': `${r.item.name} ${m.line}:${m.col}`, checked: state.selected.has(k) }) : null;
        if (cb) cb.addEventListener('change', () => {
          if (cb.checked) state.selected.add(k);
          else state.selected.delete(k);
          updateApply();
        });
        const body = h('button', { class: 'find-row', type: 'button', onclick: () => {
          dlg.close();
          setTimeout(() => handlers.onOpen(r.item, m), 0);
        } }, h('span', { class: 'problem-pos item-meta' }, `${m.line}:${m.col}`), h('span', { class: 'find-line' }, ...highlighted(m.preview, m.col, m.text.length)));
        const diff = replace && !r.skipped && state.selected.has(k) ? h('div', { class: 'find-diff item-meta' }, previewReplacement(m, template, { regex: cRe.checked }).after) : null;
        return h('div', { class: 'find-match' }, cb, h('div', { class: 'find-body' }, body, diff));
      });
      list.append(h('section', { class: 'find-section' }, head, ...rows));
    }
    updateApply();
  };
  const run = async () => {
    const token = ++state.token;
    const o = opts();
    error.textContent = '';
    if (!o.query) {
      state.results = [];
      state.selected.clear();
      status.textContent = '';
      paint();
      return;
    }
    const probe = buildRegex(o.query, o);
    if (probe.error) {
      error.textContent = probe.error;
      state.results = [];
      paint();
      return;
    }
    status.textContent = S.find.searching;
    const r = await findInItemsAsync(source.items(), o, { yieldFn: () => new Promise((res) => setTimeout(res, 0)), isCancelled: () => token !== state.token });
    if (token !== state.token || r.cancelled) return;
    if (r.error) {
      error.textContent = r.error;
      state.results = [];
      paint();
      return;
    }
    state.results = r.results;
    state.selected.clear();
    if (replace) for (const g of r.results) if (!g.skipped) for (const m of g.matches) state.selected.add(key(g, m));
    status.textContent = r.total ? `${S.find.results(r.total, r.results.length)}${r.capped ? ` ${S.find.capped(r.total)}` : ''}` : S.find.none;
    paint();
  };
  const apply = () => {
    const template = repl.value;
    const o = opts();
    let n = 0;
    let items = 0;
    const changes = [];
    for (const r of state.results) {
      if (r.skipped) continue;
      const chosen = r.matches.filter((m) => state.selected.has(key(r, m)));
      if (!chosen.length) continue;
      const it = source.items().find((x) => x.type === r.item.type && x.name === r.item.name);
      if (!it) continue;
      changes.push({ item: r.item, text: applyReplacements(it.text, chosen, template, { regex: o.regex }) });
      n += chosen.length;
      items++;
    }
    dlg.close();
    setTimeout(() => handlers.onApply(changes, S.find.replaced(n, items)), 0);
  };
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  };
  find.addEventListener('input', later);
  repl.addEventListener('input', () => paint());
  find.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      clearTimeout(timer);
      run();
    }
  });
  dlg.addEventListener('close', () => {
    state.token++;
  });
  openDialog(dlg);
  find.focus();
  find.select();
  if (initial) run();
  return dlg;
}
