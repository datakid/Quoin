import { h, clear } from '../dom.js';
import { S, errorMessage } from '../strings.js';

const BADGE_TEXT = { ready: S.setBadgeReady, edited: S.setBadgeEdited, skipped: S.setBadgeSkipped, failed: S.setBadgeFailed, pending: S.setBadgePending };

export function runBarText(session) {
  const c = session.counts();
  const p = session.progress;
  switch (session.state) {
    case 'indexing':
      return S.setRunIndexing(c.files - c.pending, c.files);
    case 'ready':
      return S.setRunReady(c.ready + c.edited, c.skipped, c.failed);
    case 'previewing':
      return S.setRunPreviewing;
    case 'running':
      return S.setRunRunning(p ? p.done : 0, p ? p.total : 0);
    case 'done':
      return S.setRunDone;
    case 'doneWithFailures':
      return S.setRunDoneFailures(c.failed);
    default:
      return '';
  }
}

export function runBarProgress(session) {
  const c = session.counts();
  const p = session.progress;
  if (session.state === 'indexing') return { value: c.files - c.pending, max: c.files };
  if (session.state === 'running' && p) return { value: p.done, max: p.total };
  return null;
}

function noteOf(f) {
  if (f.badge === 'failed') return S.setFailedNote;
  if (f.badge === 'skipped') return errorMessage(f.skipReason);
  return '';
}

function splitPath(relPath, name) {
  return relPath.length > name.length ? relPath.slice(0, relPath.length - name.length) : '';
}

export class SetShell {
  constructor(container, session, { onSummary = () => {}, onCollect = () => {}, onCancel = () => {} } = {}) {
    this.container = container;
    this.session = session;
    this.onSummary = onSummary;
    this.onCollect = onCollect;
    this.onCancel = onCancel;
    this.query = '';
    this.scheduled = false;
    this.build();
    this.off = session.subscribe(() => this.schedule());
    this.render();
  }

  build() {
    this.filter = h('input', { type: 'search', class: 'set-filter', 'aria-label': S.setFilter, placeholder: S.setFilter, autocomplete: 'off', spellcheck: 'false' });
    this.filter.addEventListener('input', () => {
      this.query = this.filter.value.trim().toLowerCase();
      this.render();
    });
    this.count = h('span', { class: 'set-count item-meta' });
    this.list = h('ul', { class: 'set-list' });
    this.empty = h('p', { class: 'set-empty item-meta' });
    this.files = h('section', { class: 'set-pane set-files', 'aria-label': S.setFiles }, h('div', { class: 'set-pane-head' }, h('h2', { class: 'set-pane-title' }, S.setFiles), this.count), this.filter, this.list, this.empty);
    this.recipe = h('section', { class: 'set-pane set-recipe', 'aria-label': S.setRecipe, tabindex: 0 }, h('h2', { class: 'set-pane-title' }, S.setRecipe));
    this.result = h('section', { class: 'set-pane set-result', 'aria-label': S.setResult, tabindex: 0 }, h('h2', { class: 'set-pane-title' }, S.setResult));
    this.runText = h('span', { class: 'set-run-text' });
    this.bar = h('progress', { class: 'set-bar', hidden: true, 'aria-label': S.setRunRunning(0, 0) });
    this.collectBtn = h('button', { class: 'btn btn-primary set-collect', type: 'button', hidden: true, onclick: () => this.onCollect() }, S.setCollect);
    this.cancelBtn = h('button', { class: 'btn set-cancel', type: 'button', hidden: true, onclick: () => this.onCancel() }, S.cancel);
    this.runbar = h('div', { class: 'set-runbar' }, h('div', { class: 'set-run-status', role: 'status' }, this.runText, this.bar), this.collectBtn, this.cancelBtn);
    this.root = h('div', { class: 'set-shell' }, this.files, this.recipe, this.result, this.runbar);
    this.container.append(this.root);
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.root.isConnected) this.render();
    });
  }

  render() {
    const all = this.session.list();
    const shown = this.query ? all.filter((f) => f.relPath.toLowerCase().includes(this.query)) : all;
    this.root.dataset.state = this.session.state;
    this.count.textContent = all.length ? S.setCount(shown.length, all.length) : '';
    clear(this.list);
    for (const f of shown) this.list.append(this.row(f));
    this.empty.hidden = shown.length > 0;
    this.empty.textContent = all.length === 0 ? S.setEmpty : S.setNoMatch;
    this.filter.hidden = all.length === 0;
    this.runText.textContent = runBarText(this.session);
    const bar = runBarProgress(this.session);
    this.bar.hidden = !bar;
    if (bar) {
      this.bar.max = bar.max;
      this.bar.value = bar.value;
      this.bar.setAttribute('aria-label', this.runText.textContent);
    }
    const counts = this.session.counts();
    this.collectBtn.hidden = !(this.session.state === 'ready' || this.session.state === 'done' || this.session.state === 'doneWithFailures') || counts.ready + counts.edited === 0;
    this.cancelBtn.hidden = this.session.state !== 'running';
    this.onSummary(counts);
  }

  row(f) {
    const badge = f.badge || 'pending';
    const note = noteOf(f);
    const dir = splitPath(f.relPath, f.name);
    return h('li', { class: 'set-file', 'data-id': f.id, 'data-badge': badge },
      h('span', { class: 'set-file-main' },
        h('span', { class: 'set-file-name', text: f.name }),
        dir ? h('span', { class: 'set-file-dir item-meta', text: dir }) : null),
      h('span', { class: 'set-badge', text: BADGE_TEXT[badge] }),
      note ? h('span', { class: 'set-file-note item-meta', text: note }) : null);
  }

  destroy() {
    this.off();
    this.root.remove();
  }
}
