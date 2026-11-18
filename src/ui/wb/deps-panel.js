import { h, clear } from '../dom.js';
import { S } from '../strings.js';

const BEAD = { ok: 'ok', error: 'error', stopped: 'stopped', cancelled: 'stopped', stale: 'stale', skipped: 'never' };

export class DepsPanel {
  constructor(host, actions) {
    this.actions = actions;
    this.root = h('div', { class: 'deps-panel' });
    host.append(this.root);
  }

  list(label, names, statuses) {
    return h('div', { class: 'deps-col' },
      h('div', { class: 'outline-label' }, label),
      names.length ? h('ul', { class: 'outline-list', role: 'list' }, ...names.map((n) => h('li', null, h('button', { class: 'dep-row', type: 'button', onclick: () => this.actions.open(n) }, h('span', { class: `bead bead-${BEAD[statuses.get(n)] || 'never'}`, 'aria-hidden': 'true' }), h('span', { class: 'step-name' }, n))))) : h('p', { class: 'item-meta dep-none' }, S.deps.none));
  }

  render(model) {
    clear(this.root);
    if (!model) return;
    const { upstream, downstream, statuses, impact } = model;
    this.root.append(
      h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, S.deps.dependsOn), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => this.actions.graph() }, S.deps.graph)),
      h('div', { class: 'deps-cols' }, this.list(S.deps.dependsOn, upstream, statuses), this.list(S.deps.usedBy, downstream, statuses)),
      h('p', { class: 'item-meta deps-impact' }, impact.count ? S.deps.impact(impact.count, impact.loaded) : S.deps.noImpact));
  }
}
