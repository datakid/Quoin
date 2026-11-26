import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { openDialog } from '../dialogs.js';

const T = () => S.sourcesUi;

function describe(src) {
  if (src.dynamic) return { note: T().dynamic(src.call) };
  if (!src.bindable) return { note: T().unsupported(src.call) };
  return null;
}

export function sourcesDialog({ inventory, boundName, choose, clearBinding }) {
  let pending = null;
  const list = h('ul', { class: 'sources-list' });
  const msg = h('div', { class: 'colwork-msg', 'aria-live': 'polite' });
  const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const paint = () => {
    clear(list);
    const all = [...inventory.sources.values()];
    if (!all.length) {
      list.append(h('li', { class: 'item-meta' }, T().empty));
      return;
    }
    for (const src of all) {
      const label = src.dynamic ? T().dynamicTitle : src.key;
      const info = describe(src);
      const name = !src.dynamic && src.bindable ? boundName(src.key) : null;
      const row = h('li', { class: 'source-row' },
        h('div', { class: 'source-key' }, label),
        h('div', { class: 'item-meta' }, `${T().kinds[src.kind] || T().kinds.other} \u00b7 ${src.call}`),
        h('div', { class: 'item-meta' }, T().usedBy(src.queries)));
      if (info) row.append(h('div', { class: 'item-meta' }, info.note));
      else {
        row.append(h('div', { class: name ? 'source-state is-bound' : 'source-state' }, name ? T().bound(name) : T().notBound));
        const actions = h('div', { class: 'source-actions' },
          h('button', { class: 'btn', type: 'button', 'aria-label': T().chooseFor(src.key), onclick: () => {
            pending = src;
            input.click();
          } }, T().choose));
        if (name) actions.append(h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': T().clearFor(src.key), onclick: () => {
          clearBinding(src.key);
          paint();
        } }, T().clear));
        row.append(actions);
      }
      list.append(row);
    }
  };
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    const src = pending;
    input.value = '';
    pending = null;
    if (!file || !src) return;
    msg.textContent = '';
    const ok = await choose(src.key, src.kind, file);
    if (!ok) msg.textContent = T().bindFailed(src.key);
    paint();
  });
  const dlg = h('dialog', { class: 'colwork wide', 'aria-labelledby': 'src-title' },
    h('h2', { id: 'src-title' }, T().title),
    h('p', { class: 'item-meta' }, T().intro),
    list,
    input,
    msg,
    h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dlg.close() }, T().close)));
  paint();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(true));
    openDialog(dlg);
  });
}

export function unboundDialog(sources) {
  return new Promise((resolve) => {
    let choice = null;
    const done = (c) => {
      choice = c;
      dlg.close();
    };
    const dlg = h('dialog', { class: 'colwork wide', 'aria-labelledby': 'ub-title' },
      h('h2', { id: 'ub-title' }, T().upfrontTitle),
      h('p', null, T().upfrontBody(sources.length)),
      h('ul', { class: 'sources-list' }, ...sources.map((s) => h('li', { class: 'source-row' }, h('div', { class: 'source-key' }, s.key), h('div', { class: 'item-meta' }, T().usedBy(s.queries))))),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done('bind') }, T().bindNow),
        h('button', { class: 'btn', type: 'button', onclick: () => done('run') }, T().runAnyway),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => done(null) }, T().cancel)));
    dlg.addEventListener('close', () => resolve(choice));
    openDialog(dlg);
  });
}
