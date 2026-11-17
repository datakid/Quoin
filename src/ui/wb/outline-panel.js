import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { menu } from '../dialogs.js';

export class OutlinePanel {
  constructor(host, actions) {
    this.actions = actions;
    this.title = h('span', { class: 'panel-title' }, S.outline.title);
    this.count = h('span', { class: 'count-pill' }, '0');
    this.head = h('div', { class: 'panel-head' }, this.title, this.count);
    this.body = h('div', { class: 'outline-body', role: 'region', 'aria-label': S.outline.aria });
    this.live = h('div', { class: 'sr-only steps-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
    host.append(this.head, this.body, this.live);
  }

  announce(text) {
    this.live.textContent = '';
    this.live.textContent = text;
  }

  signature(p) {
    const args = p.params.map((x) => x.name).join(', ');
    return `${p.name}(${args})`;
  }

  render(outline, match, caretLine, links = new Map()) {
    clear(this.body);
    this.count.textContent = String(outline ? outline.procedures.length : 0);
    if (!outline) return;
    const opts = [];
    if (outline.options.explicit) opts.push('Option Explicit');
    if (outline.options.compare) opts.push(`Option Compare ${outline.options.compare[0].toUpperCase()}${outline.options.compare.slice(1)}`);
    if (outline.options.base !== null) opts.push(`Option Base ${outline.options.base}`);
    if (outline.options.private) opts.push('Option Private Module');
    if (opts.length) this.body.append(h('div', { class: 'outline-block' }, h('div', { class: 'outline-label' }, S.outline.options), h('div', { class: 'outline-chips' }, ...opts.map((o) => h('span', { class: 'step-kind' }, o)))));
    if (outline.declarations.length) {
      this.body.append(h('div', { class: 'outline-block' }, h('div', { class: 'outline-label' }, `${S.outline.declarations} ${outline.declarations.length}`),
        h('ul', { class: 'outline-list', role: 'list' }, ...outline.declarations.map((d) => h('li', null, h('button', { class: 'outline-row', type: 'button', onclick: () => this.actions.go(d.line) }, h('span', { class: 'step-kind' }, S.outline.decl[d.kind] || d.kind), h('span', { class: 'step-name' }, d.name), h('span', { class: 'item-meta' }, d.scope)))))));
    }
    const status = new Map(match ? match.rows.map((r) => [r.key, r.status]) : []);
    const keys = new Map();
    const seen = new Map();
    for (const p of outline.procedures) {
      const base = `${p.kind}:${p.name.toLowerCase()}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      keys.set(p, n > 1 ? `${base}#${n}` : base);
    }
    const procRows = outline.procedures.map((p) => {
      const key = keys.get(p);
      const st = status.get(key) || 'same';
      const current = caretLine >= p.startLine && caretLine <= p.endLine;
      const more = st === 'same' ? null : h('button', { class: 'btn btn-quiet step-more', type: 'button', 'aria-label': `${S.outline.revert}: ${p.name}`, 'aria-haspopup': 'menu', onclick: (ev) => {
        const btn = ev.currentTarget;
        menu(btn, [{ label: S.outline.revert, run: () => this.actions.revert(key, p.name) }], () => btn.focus());
      } }, '\u22ef');
      const lk = links.get(p.name);
      const linkBlock = lk ? h('div', { class: 'outline-links' },
        h('div', { class: 'outline-label' }, S.pqLinks.refreshes),
        ...lk.plan.names.map((n) => h('div', { class: 'outline-link' }, n)),
        lk.hasAll ? h('div', { class: 'outline-link item-meta' }, S.pqLinks.all) : null,
        lk.reads.length ? h('div', { class: 'outline-link item-meta' }, `${S.pqLinks.reads}: ${lk.reads.join(', ')}`) : null,
        lk.plan.dynamic.length ? h('div', { class: 'outline-link item-meta' }, S.pqLinks.dynamic(lk.plan.dynamic.length)) : null,
        lk.plan.unknown.length ? h('div', { class: 'outline-link item-meta' }, S.pqLinks.unknown(lk.plan.unknown.map((u) => u.name))) : null,
        lk.plan.names.length ? h('button', { class: 'btn', type: 'button', onclick: () => this.actions.runLinked(p.name, lk.plan.names) }, S.pqLinks.runThese) : null) : null;
      return h('li', { class: 'step-item outline-proc' },
        h('button', { class: `outline-row${current ? ' is-current' : ''}`, type: 'button', 'aria-current': current ? 'true' : null, 'data-key': key, onclick: () => this.actions.go(p.startLine) },
          h('span', { class: 'step-kind' }, S.outline.kind[p.kind] || p.kind),
          h('span', { class: 'step-name' }, this.signature(p)),
          p.scope === 'private' ? h('span', { class: 'item-meta' }, S.outline.private) : null,
          p.isEntryPoint ? h('span', { class: 'step-tag entry' }, S.outline.entry) : null,
          p.isEventHandler ? h('span', { class: 'step-tag event' }, S.outline.event) : null,
          st === 'edited' ? h('span', { class: 'step-tag' }, S.outline.edited) : null,
          st === 'added' ? h('span', { class: 'step-tag' }, S.outline.added) : null),
        more, linkBlock);
    });
    this.body.append(h('div', { class: 'outline-block' }, h('div', { class: 'outline-label' }, `${S.outline.procedures} ${outline.procedures.length}`), outline.procedures.length ? h('ul', { class: 'outline-list', role: 'list' }, ...procRows) : h('p', { class: 'panel-note item-meta' }, S.outline.empty)));
    if (match && match.removed.length) {
      this.body.append(h('div', { class: 'outline-block' }, h('div', { class: 'outline-label' }, S.outline.removed),
        h('ul', { class: 'outline-list', role: 'list' }, ...match.removed.map((r) => h('li', { class: 'step-item' }, h('span', { class: 'outline-row is-bypassed' }, h('span', { class: 'step-kind' }, S.outline.kind[r.kind] || r.kind), h('span', { class: 'step-name' }, r.name)), h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => this.actions.putBack(r.key, r.name) }, S.outline.putBack))))));
    }
  }
}
