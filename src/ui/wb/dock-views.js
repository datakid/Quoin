import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { schemaDiff, rowDelta, diffCells } from '../../core/wb/compare-results.js';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function pinLabel(p) {
  return [p.query, p.step].filter(Boolean).join(' \u203a ');
}

export function renderPinned(host, pins, { isStale, onShow, onUnpin, onCompare }) {
  clear(host);
  if (!pins.length) {
    host.append(h('p', { class: 'dock-empty' }, S.dock.pinnedEmpty));
    return;
  }
  const list = h('ul', { class: 'pin-list', role: 'list', 'aria-label': S.dock.tabs.pinned });
  for (const p of pins) {
    const stale = isStale(p);
    list.append(h('li', { class: 'pin-row', 'data-id': p.id },
      h('span', { class: 'pin-name' }, pinLabel(p)),
      h('span', { class: 'item-meta' }, `${clock.format(p.at)} \u00b7 ${S.dock.shape(p.rowCount, p.columns.length)}`),
      stale ? h('span', { class: 'pin-stale' }, S.dock.stale) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.dock.showPin(pinLabel(p)), onclick: () => onShow(p) }, S.dock.show),
      h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.dock.comparePin(pinLabel(p)), onclick: () => onCompare(p) }, S.dock.tabs.compare),
      h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.dock.unpinPin(pinLabel(p)), onclick: () => onUnpin(p) }, S.dock.unpin)));
  }
  host.append(list);
}

export function renderQueue(host, rows, summary) {
  clear(host);
  if (!rows.length) {
    host.append(h('p', { class: 'dock-empty' }, S.dock.queueEmpty));
    return;
  }
  const table = h('table', { class: 'queue-table', 'aria-label': S.dock.tabs.queue },
    h('thead', null, h('tr', null, ...['name', 'status', 'rows', 'time'].map((k) => h('th', { scope: 'col' }, S.dock.queueHead[k])))),
    h('tbody', null, ...rows.map((r) => h('tr', { 'data-name': r.name },
      h('td', null, r.name),
      h('td', null, h('span', { class: `queue-state state-${r.status}` }, S.batch.state[r.status] || r.status)),
      h('td', { class: 'num' }, r.rows === null || r.rows === undefined ? '' : String(r.rows)),
      h('td', { class: 'num' }, r.durationMs === null || r.durationMs === undefined ? '' : S.dock.ms(Math.round(r.durationMs)))))));
  host.append(h('p', { class: 'item-meta queue-summary' }, summary), h('div', { class: 'queue-scroll' }, table));
}

export function renderCompare(host, options, state, fetchRows, onChange) {
  clear(host);
  if (options.length < 2) {
    host.append(h('p', { class: 'dock-empty' }, S.dock.compareNeed));
    return;
  }
  const pick = (label, key) => {
    const sel = h('select', { class: 'dock-select', 'aria-label': label }, ...options.map((o) => h('option', { value: o.id }, o.label)));
    sel.value = state[key] && options.some((o) => o.id === state[key]) ? state[key] : options[key === 'a' ? 0 : 1].id;
    state[key] = sel.value;
    sel.addEventListener('change', () => {
      state[key] = sel.value;
      onChange();
    });
    return h('label', { class: 'nav-field' }, h('span', { class: 'nav-field-label' }, label), sel);
  };
  const out = h('div', { class: 'compare-out', role: 'status', 'aria-live': 'polite' });
  host.append(h('div', { class: 'compare-pick' }, pick(S.dock.compareA, 'a'), pick(S.dock.compareB, 'b')), out);
  const a = options.find((o) => o.id === state.a);
  const b = options.find((o) => o.id === state.b);
  if (a.id === b.id) {
    out.append(h('p', { class: 'dock-empty' }, S.dock.compareSame));
    return;
  }
  out.append(h('p', { class: 'item-meta' }, S.dock.comparing));
  Promise.all([fetchRows(a), fetchRows(b)]).then(([ra, rb]) => {
    if (!out.isConnected) return;
    clear(out);
    const sd = schemaDiff(a.columns, b.columns);
    const rd = rowDelta(a.rowCount, b.rowCount);
    const sec = (title, ...kids) => h('section', { class: 'compare-sec' }, h('h3', null, title), ...kids);
    const schema = sd.same
      ? h('p', null, S.dock.schemaSame)
      : h('ul', null,
        ...sd.added.map((n) => h('li', null, S.dock.colAdded(n))),
        ...sd.removed.map((n) => h('li', null, S.dock.colRemoved(n))),
        ...sd.retyped.map((r) => h('li', null, S.dock.colRetyped(r.name, r.from, r.to))));
    out.append(sec(S.dock.schema, schema), sec(S.dock.rowsHead, h('p', null, S.dock.rowDelta(rd.a, rd.b, rd.delta))));
    if (ra.evicted || rb.evicted) {
      out.append(sec(S.dock.cellsHead, h('p', null, S.dock.gone)));
      return;
    }
    const d = diffCells(ra.rows, rb.rows, 200);
    const cells = d.total
      ? h('div', { class: 'queue-scroll' }, h('table', { class: 'queue-table', 'aria-label': S.dock.cellsHead },
        h('thead', null, h('tr', null, ...['row', 'col', 'a', 'b'].map((k) => h('th', { scope: 'col' }, S.dock.cellHead[k])))),
        h('tbody', null, ...d.cells.map((c) => h('tr', null, h('td', { class: 'num' }, String(c.row + 1)), h('td', null, (a.columns[c.col] || {}).name || String(c.col + 1)), h('td', null, show(c.a)), h('td', null, show(c.b)))))))
      : h('p', null, S.dock.cellsSame(d.scanned));
    out.append(sec(S.dock.cellsHead, d.total ? h('p', { class: 'item-meta' }, S.dock.cellsCount(d.total, d.cells.length, d.scanned)) : null, cells));
  });
}

function show(v) {
  if (v === null || v === undefined) return S.nullText;
  if (typeof v === 'object') return v.text || v.special || JSON.stringify(v);
  return String(v);
}
