import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { filterProblems, countProblems } from '../../core/wb/problems.js';
import { openDialog } from '../dialogs.js';

const SEV_GLYPH = { error: '\u2715', warning: '!', info: 'i' };

export function openProblems(getRows, handlers) {
  const state = { sev: null, kind: null, active: 0 };
  const list = h('ul', { class: 'problems-list', role: 'list', 'aria-label': S.problems.title });
  const filters = h('div', { class: 'problems-filters', role: 'group', 'aria-label': S.problems.title });
  const status = h('div', { class: 'problems-status item-meta', role: 'status', 'aria-live': 'polite' });
  const close = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, S.close);
  const dlg = h('dialog', { class: 'problems', 'aria-labelledby': 'problems-title' }, h('h2', { id: 'problems-title' }, S.problems.title), filters, list, status, h('div', { class: 'dialog-actions' }, close));
  const defs = [['sev', null, S.problems.filters.all], ['sev', 'error', S.problems.filters.error], ['sev', 'warning', S.problems.filters.warning], ['sev', 'info', S.problems.filters.info], ['kind', 'query', S.problems.filters.query], ['kind', 'module', S.problems.filters.module]];
  const paintFilters = () => {
    clear(filters);
    const all = getRows();
    const c = countProblems(all);
    for (const [group, value, label] of defs) {
      const n = group === 'sev' ? (value ? c[value] : all.length) : all.filter((r) => r.item.type === value).length;
      const pressed = state[group] === value;
      filters.append(h('button', { class: `btn btn-quiet filter${pressed ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(pressed), onclick: () => {
        state[group] = state[group] === value ? null : value;
        paint();
      } }, `${label} ${n}`));
    }
  };
  const paint = () => {
    paintFilters();
    clear(list);
    const rows = filterProblems(getRows(), { severities: state.sev ? [state.sev] : null, itemType: state.kind });
    rows.forEach((r) => {
      const where = [r.item.name, r.where].filter(Boolean).join(' \u203a ');
      list.append(h('li', null, h('button', { class: `problem-row sev-${r.severity}`, type: 'button', onclick: () => {
        dlg.close();
        setTimeout(() => handlers.onOpen(r), 0);
      } },
      h('span', { class: 'problem-glyph', 'aria-hidden': 'true' }, SEV_GLYPH[r.severity]),
      h('span', { class: 'sr-only' }, S.problems.severity[r.severity]),
      h('span', { class: 'problem-where' }, where),
      h('span', { class: 'problem-pos item-meta' }, `${r.line}:${r.col}`),
      h('span', { class: 'problem-msg' }, S.problem[r.code](r.args)))));
    });
    status.textContent = rows.length ? S.palette.count(rows.length) : S.problems.none;
  };
  openDialog(dlg);
  paint();
  const first = list.querySelector('button');
  if (first) first.focus();
  else close.focus();
  return dlg;
}
