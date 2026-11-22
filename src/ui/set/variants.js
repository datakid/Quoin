import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { diffTable } from '../dialogs.js';

const MAX_FILES_SHOWN = 20;

const variantKey = (item) => `${item.kind}:${item.name}`;

export class VariantsPanel {
  constructor(host, { loadText }) {
    this.loadText = loadText;
    this.open = new Set();
    this.selected = new Map();
    this.token = 0;
    this.lead = h('p', { class: 'variants-lead item-meta' });
    this.list = h('ul', { class: 'variants-list' });
    this.root = h('section', { class: 'variants', 'aria-label': S.variantsTitle }, h('h3', { class: 'variants-title' }, S.variantsTitle), this.lead, this.list);
    host.append(this.root);
  }

  setData({ items, drifted }) {
    this.items = items;
    this.lead.textContent = items.length === 0 ? '' : drifted === 0 ? S.variantsNone : S.variantsSome(drifted);
    clear(this.list);
    for (const item of items) this.list.append(this.itemEl(item));
  }

  itemEl(item) {
    const key = variantKey(item);
    const diff = h('div', { class: 'variant-diff', 'aria-live': 'polite' });
    const buttons = item.versions.map((v, i) => {
      const label = [S.variantVersion(i + 1), S.variantFileCount(v.count), i === 0 ? S.variantMostCommon : null].filter(Boolean).join(' · ');
      const btn = h('button', { class: 'variant-version', type: 'button', 'aria-pressed': this.selected.get(key) === v.hash ? 'true' : 'false', 'data-hash': v.hash, onclick: () => this.choose(item, v, diff, buttons) }, label);
      return btn;
    });
    const details = h('details', { class: 'variant-item', 'data-key': key, open: this.open.has(key) ? true : null },
      h('summary', { class: 'variant-head' },
        h('span', { class: 'variant-name', text: item.name }),
        h('span', { class: 'variant-kind item-meta', text: item.kind === 'query' ? S.variantKindQuery : S.variantKindModule }),
        h('span', { class: 'variant-summary item-meta', text: S.variantSummary(item.files, item.versions.length) })),
      h('div', { class: 'variant-body' }, h('div', { class: 'variant-buttons' }, ...buttons), diff));
    details.addEventListener('toggle', () => {
      if (details.open) this.open.add(key);
      else this.open.delete(key);
    });
    const chosen = this.selected.get(key);
    if (chosen && this.open.has(key)) {
      const v = item.versions.find((x) => x.hash === chosen);
      if (v) this.choose(item, v, diff, buttons);
    }
    return h('li', { class: 'variant', 'data-drift': item.drift ? 'true' : 'false' }, details);
  }

  filesLine(version) {
    const names = version.files.slice(0, MAX_FILES_SHOWN).map((f) => f.relPath).join(', ');
    const more = version.files.length - MAX_FILES_SHOWN;
    return h('p', { class: 'variant-files item-meta', text: S.variantFiles(more > 0 ? `${names} ${S.variantMore(more)}` : names) });
  }

  async choose(item, version, diff, buttons) {
    const key = variantKey(item);
    this.selected.set(key, version.hash);
    for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.hash === version.hash ? 'true' : 'false');
    const mine = ++this.token;
    clear(diff);
    if (version.hash === item.mostCommon) {
      diff.append(h('p', { class: 'item-meta', text: S.variantIsCommon }), this.filesLine(version));
      return;
    }
    diff.append(h('p', { class: 'item-meta', text: S.variantLoading }));
    try {
      const common = item.versions[0];
      const [before, after] = await Promise.all([this.loadText(item, common), this.loadText(item, version)]);
      if (mine !== this.token && this.selected.get(key) !== version.hash) return;
      clear(diff);
      diff.append(diffTable(item.name, before, after), this.filesLine(version));
    } catch {
      clear(diff);
      diff.append(h('p', { class: 'item-meta', text: S.variantFailed }));
    }
  }

  destroy() {
    this.root.remove();
  }
}
