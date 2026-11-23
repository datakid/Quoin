import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { openDialog } from '../dialogs.js';
import { generateStep } from '../../core/wb/m-gen.js';
import { distinctLabel } from '../../core/wb/profile.js';

let seq = 0;
const uid = (p) => `${p}-${++seq}`;

export function baseType(type) {
  const t = String(type || 'any').replace(/^nullable /, '');
  if (t === 'text' || t === 'number' || t === 'logical' || t === 'date' || t === 'datetime') return t;
  return 'any';
}

const OPS = {
  text: ['equals', 'notEquals', 'contains', 'beginsWith', 'endsWith', 'isNull', 'isNotNull'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  date: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  datetime: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  logical: ['equals', 'notEquals', 'isNull', 'isNotNull'],
  any: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'contains', 'beginsWith', 'endsWith', 'isNull', 'isNotNull']
};

const NO_VALUE = new Set(['isNull', 'isNotNull']);
const TEXT_OPS = new Set(['contains', 'beginsWith', 'endsWith']);

export function opsFor(type) {
  return OPS[baseType(type)];
}

export function parseValue(kind, op, raw) {
  const text = String(raw === null || raw === undefined ? '' : raw);
  if (TEXT_OPS.has(op)) return { ok: true, value: text };
  if (kind === 'logical') return { ok: true, value: text === 'true' };
  if (kind === 'number') {
    const n = Number(text);
    return text.trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: S.colTools.needNumber };
  }
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? { ok: true, value: { date: text.trim() } } : { ok: false, reason: S.colTools.needDate };
  if (kind === 'datetime') return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(text.trim()) ? { ok: true, value: { datetime: text.trim() } } : { ok: false, reason: S.colTools.needDate };
  if (kind === 'any') {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) return { ok: true, value: n };
  }
  return { ok: true, value: text };
}

export function entryValue(entry) {
  const v = entry.value;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return { ok: true, value: v };
  if (v && v.k === 'date') return { ok: true, value: { date: v.text } };
  if (v && v.k === 'datetime') return { ok: true, value: { datetime: v.text } };
  return { ok: false };
}

function field(label, control, id) {
  return [h('label', { for: id }, label), control];
}

function message() {
  return h('div', { class: 'colwork-msg', 'aria-live': 'polite' });
}

export function filterDialog({ column, type, loadValues, onApply }) {
  const kind = baseType(type);
  const T = S.colTools;
  const titleId = uid('cf-title');
  const modeName = uid('cf-mode');
  const msg = message();
  const valuesRadio = h('input', { type: 'radio', name: modeName, value: 'values', checked: true, id: uid('cf-mv') });
  const condRadio = h('input', { type: 'radio', name: modeName, value: 'condition', id: uid('cf-mc') });
  const search = h('input', { type: 'text', id: uid('cf-search'), 'aria-label': T.searchValues, placeholder: T.searchValues, autocomplete: 'off' });
  const list = h('div', { class: 'colwork-values', role: 'group', 'aria-label': T.valuesLabel });
  const note = h('p', { class: 'item-meta' }, T.valuesLoading);
  const chosen = new Map();
  let entries = [];
  const opId = uid('cf-op');
  const valId = uid('cf-val');
  const op = h('select', { id: opId }, ...opsFor(type).map((o) => h('option', { value: o }, T.ops[o])));
  const valueInput = kind === 'logical'
    ? h('select', { id: valId }, h('option', { value: 'true' }, S.booleanTrue), h('option', { value: 'false' }, S.booleanFalse))
    : h('input', { type: 'text', id: valId, autocomplete: 'off' });
  const ignoreCase = h('input', { type: 'checkbox', id: uid('cf-ic') });
  const valueRow = field(T.valueLabel, valueInput, valId);
  const caseRow = h('label', { class: 'check', for: ignoreCase.id }, ignoreCase, T.ignoreCase);
  const condition = h('div', { class: 'form-grid', hidden: true }, ...field(T.conditionLabel, op, opId), ...valueRow, caseRow, h('span'));
  const valuesPane = h('div', { class: 'colwork-pane' }, search, list, note);
  const syncCondition = () => {
    const none = NO_VALUE.has(op.value);
    valueRow.forEach((el) => {
      el.hidden = none;
    });
    caseRow.hidden = !TEXT_OPS.has(op.value);
  };
  const syncMode = () => {
    const values = valuesRadio.checked;
    valuesPane.hidden = !values;
    condition.hidden = values;
    if (!values) syncCondition();
    msg.textContent = '';
  };
  const renderList = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || e.label.toLowerCase().includes(q));
    if (!entries.length) {
      list.append(h('p', { class: 'item-meta' }, T.valuesNone));
      return;
    }
    shown.forEach((e) => {
      const id = uid('cf-v');
      const box = h('input', { type: 'checkbox', id, checked: chosen.has(e.key), onchange: () => {
        if (box.checked) chosen.set(e.key, e.value);
        else chosen.delete(e.key);
      } });
      list.append(h('label', { class: 'check colwork-value', for: id }, box, h('span', { class: 'colwork-label' }, e.label), h('span', { class: 'colwork-count' }, e.count)));
    });
  };
  const dlg = h('dialog', { 'aria-labelledby': titleId, class: 'colwork' },
    h('h2', { id: titleId }, T.filterTitle(column)),
    h('p', { class: 'item-meta' }, T.filterNote),
    h('div', { class: 'colwork-modes', role: 'radiogroup', 'aria-label': T.modeLabel },
      h('label', { class: 'check', for: valuesRadio.id }, valuesRadio, T.modeValues),
      h('label', { class: 'check', for: condRadio.id }, condRadio, T.modeCondition)),
    valuesPane,
    condition,
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T.cancel),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
        if (valuesRadio.checked) {
          if (!chosen.size) {
            msg.textContent = T.needChoice;
            return;
          }
          onApply({ column, op: 'in', values: [...chosen.values()] });
          dlg.close();
          return;
        }
        const o = op.value;
        if (NO_VALUE.has(o)) {
          onApply({ column, op: o });
          dlg.close();
          return;
        }
        const parsed = parseValue(kind, o, valueInput.value);
        if (!parsed.ok) {
          msg.textContent = parsed.reason;
          return;
        }
        if (TEXT_OPS.has(o) && parsed.value === '') {
          msg.textContent = T.needValue;
          return;
        }
        const spec = { column, op: o, value: parsed.value };
        if (TEXT_OPS.has(o) && ignoreCase.checked) spec.ignoreCase = true;
        onApply(spec);
        dlg.close();
      } }, T.applyFilter)));
  valuesRadio.addEventListener('change', syncMode);
  condRadio.addEventListener('change', syncMode);
  op.addEventListener('change', syncCondition);
  search.addEventListener('input', renderList);
  syncCondition();
  openDialog(dlg);
  search.focus();
  loadValues().then((res) => {
    if (!dlg.isConnected) return;
    entries = [];
    if (res && res.profile) {
      const p = res.profile;
      if (p.nulls) entries.push({ key: 'null', label: T.nullLabel, value: null, count: String(p.nulls) });
      for (const t of p.top) {
        const v = entryValue(t);
        if (!v.ok) continue;
        entries.push({ key: `${t.kind}:${t.text}`, label: t.text === '' ? T.emptyLabel : t.text, value: v.value, count: String(t.count) });
      }
      note.textContent = p.distinct > p.top.length || p.distinctCapped ? T.valuesCapped(p.top.length) : '';
    } else note.textContent = S.colTools.gone;
    renderList();
  });
  return dlg;
}

const STEP_TYPES = ['text', 'number', 'integer', 'date', 'logical'];

export function stepDialog({ column, type, prevName, existing, onInsert }) {
  const T = S.colTools;
  const kind = baseType(type);
  const titleId = uid('as-title');
  const msg = message();
  const actionId = uid('as-act');
  const actions = ['sortAsc', 'sortDesc', 'filter', 'removeColumns', 'keepColumns', 'renameColumn', 'changeType', 'removeDuplicates'];
  const action = h('select', { id: actionId }, ...actions.map((a) => h('option', { value: a }, T.stepActions[a])));
  const opId = uid('as-op');
  const valId = uid('as-val');
  const nameId = uid('as-new');
  const typeId = uid('as-type');
  const op = h('select', { id: opId }, ...opsFor(type).map((o) => h('option', { value: o }, T.ops[o])));
  const valueInput = kind === 'logical'
    ? h('select', { id: valId }, h('option', { value: 'true' }, S.booleanTrue), h('option', { value: 'false' }, S.booleanFalse))
    : h('input', { type: 'text', id: valId, autocomplete: 'off' });
  const newName = h('input', { type: 'text', id: nameId, value: column, autocomplete: 'off' });
  const typeSel = h('select', { id: typeId }, ...STEP_TYPES.map((x) => h('option', { value: x }, T.stepTypes[x])));
  const opRow = field(T.conditionLabel, op, opId);
  const valRow = field(T.valueLabel, valueInput, valId);
  const nameRow = field(T.stepNewName, newName, nameId);
  const typeRow = field(T.stepType, typeSel, typeId);
  const stepNameId = uid('as-sn');
  const codeId = uid('as-code');
  const stepName = h('input', { type: 'text', id: stepNameId, autocomplete: 'off' });
  const code = h('textarea', { id: codeId, rows: '4', spellcheck: 'false', class: 'colwork-code' });
  const reset = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => {
    dirty = false;
    regenerate();
  } }, T.stepRegenerate);
  let dirty = false;
  const insert = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
    const name = stepName.value.trim();
    const expr = code.value.trim();
    if (!name || !expr) return;
    const res = onInsert({ name, expr });
    if (res && res.ok) dlg.close();
    else msg.textContent = (res && res.reason) || '';
  } }, T.stepInsert);
  const build = () => {
    const a = action.value;
    if (a === 'sortAsc' || a === 'sortDesc') return { type: 'sort', columns: [{ name: column, descending: a === 'sortDesc' }] };
    if (a === 'removeColumns') return { type: 'removeColumns', columns: [column] };
    if (a === 'keepColumns') return { type: 'keepColumns', columns: [column] };
    if (a === 'removeDuplicates') return { type: 'removeDuplicates', columns: [column] };
    if (a === 'renameColumn') return { type: 'renameColumn', renames: [{ from: column, to: newName.value }] };
    if (a === 'changeType') return { type: 'changeType', columns: [{ name: column, type: typeSel.value }] };
    const o = op.value;
    if (NO_VALUE.has(o)) return { type: 'filter', column, op: o };
    const parsed = parseValue(kind, o, valueInput.value);
    if (!parsed.ok) throw new Error(parsed.reason);
    const spec = { type: 'filter', column, op: o, value: parsed.value };
    if (TEXT_OPS.has(o)) spec.ignoreCase = false;
    return spec;
  };
  const syncParams = () => {
    const a = action.value;
    const isFilter = a === 'filter';
    const none = NO_VALUE.has(op.value);
    opRow.forEach((el) => {
      el.hidden = !isFilter;
    });
    valRow.forEach((el) => {
      el.hidden = !isFilter || none;
    });
    nameRow.forEach((el) => {
      el.hidden = a !== 'renameColumn';
    });
    typeRow.forEach((el) => {
      el.hidden = a !== 'changeType';
    });
  };
  function regenerate() {
    syncParams();
    reset.hidden = !dirty;
    if (dirty) return;
    try {
      const step = generateStep(build(), { prev: prevName, existing, names: S.stepNames });
      stepName.value = step.name;
      code.value = step.expr;
      msg.textContent = '';
      insert.disabled = false;
    } catch (e) {
      msg.textContent = String(e && e.message);
      insert.disabled = true;
    }
  }
  const dlg = h('dialog', { 'aria-labelledby': titleId, class: 'colwork wide' },
    h('h2', { id: titleId }, T.stepTitle(column)),
    h('p', { class: 'item-meta' }, T.stepWhere(prevName)),
    h('div', { class: 'form-grid' },
      ...field(T.stepAction, action, actionId),
      ...opRow,
      ...valRow,
      ...nameRow,
      ...typeRow,
      ...field(T.stepName, stepName, stepNameId)),
    h('label', { class: 'colwork-codelabel', for: codeId }, T.stepCode),
    code,
    h('p', { class: 'item-meta' }, T.stepCodeNote),
    reset,
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T.cancel),
      insert));
  [action, op, valueInput, newName, typeSel].forEach((el) => {
    el.addEventListener('change', regenerate);
    el.addEventListener('input', regenerate);
  });
  code.addEventListener('input', () => {
    dirty = true;
    reset.hidden = false;
  });
  stepName.addEventListener('input', () => {
    dirty = true;
    reset.hidden = false;
  });
  regenerate();
  openDialog(dlg);
  action.focus();
  return dlg;
}

export function profileSheet({ column, type, columnType, load, formats, onFilter }) {
  const T = S.colTools;
  const titleId = uid('pf-title');
  const body = h('div', { class: 'colwork-profile', 'aria-live': 'polite' }, h('p', { class: 'item-meta' }, T.profileBusy));
  const dlg = h('dialog', { 'aria-labelledby': titleId, class: 'colwork sheet' },
    h('h2', { id: titleId }, T.profileTitle(column)),
    body,
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T.close)));
  openDialog(dlg);
  const int = (n) => formats.integer.format(n);
  const num = (n) => formats.number.format(n);
  const row = (label, value) => [h('dt', null, label), h('dd', null, value)];
  load().then((res) => {
    if (!dlg.isConnected) return;
    clear(body);
    if (!res || !res.profile) {
      body.append(h('p', { class: 'item-meta' }, res && res.error === 'evicted' ? T.gone : T.profileFailed));
      return;
    }
    const p = res.profile;
    const stats = [...row(T.pRows, int(p.count)), ...row(T.pNulls, int(p.nulls)), ...row(T.pErrors, int(p.errors)), ...row(T.pDistinct, distinctLabel(p, int))];
    if (p.min !== null) stats.push(...row(T.pMin, num(p.min)), ...row(T.pMax, num(p.max)), ...row(T.pMean, num(p.mean)));
    if (p.earliest !== null) stats.push(...row(T.pEarliest, p.earliest), ...row(T.pLatest, p.latest));
    if (p.lengthMin !== null) stats.push(...row(T.pLength, T.pLengthRange(int(p.lengthMin), int(p.lengthMax))));
    body.append(h('dl', { class: 'colwork-stats' }, ...stats));
    if (p.mixed && baseType(columnType || type) === 'any') body.append(h('p', { class: 'item-meta' }, T.pMixed(String(columnType || type || 'any'))));
    if (!p.top.length) {
      body.append(h('p', { class: 'item-meta' }, T.pNoValues));
      return;
    }
    body.append(h('h3', null, T.pTop));
    const top = h('ol', { class: 'colwork-top' });
    for (const t of p.top) {
      const pct = Math.round(t.share * 100);
      const bar = h('span', { class: 'colwork-bar' });
      bar.style.width = `${Math.max(2, pct)}%`;
      const entry = entryValue(t);
      const label = t.text === '' ? T.emptyLabel : t.text;
      top.append(h('li', null,
        entry.ok && onFilter
          ? h('button', { class: 'btn btn-quiet colwork-pick', type: 'button', 'aria-label': T.pFilterTo(label), onclick: () => {
            dlg.close();
            onFilter({ column, op: 'in', values: [entry.value] });
          } }, label)
          : h('span', { class: 'colwork-pick' }, label),
        h('span', { class: 'colwork-barbox', 'aria-hidden': 'true' }, bar),
        h('span', { class: 'colwork-count' }, `${int(t.count)} · ${T.pShare(pct)}`)));
    }
    body.append(top);
    if (p.topApproximate) body.append(h('p', { class: 'item-meta' }, T.pTopApprox));
    body.append(h('h3', null, T.pMix));
    body.append(h('ul', { class: 'colwork-kinds' }, ...p.kinds.map((k) => h('li', null, `${int(k.count)} ${T.kinds[k.kind] || T.kinds.other}`))));
  });
  return dlg;
}
