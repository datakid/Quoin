import { h, clear } from '../dom.js';
import { S, errorMessage } from '../strings.js';
import { ResultMatrix } from './result-matrix.js';
import { VariantsPanel } from './variants.js';
import { RecipePanel } from './recipe-panel.js';
import { diffTable } from '../dialogs.js';

const SETTLED = ['ready', 'done', 'doneWithFailures'];
const BUSY = ['previewing', 'running'];

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
  constructor(container, session, { onSummary = () => {}, onCollect = () => {}, onCancel = () => {}, onOpen = () => {}, onLoadRecipe = () => {}, onClearRecipe = () => {}, onPreview = () => {}, onGet = () => {}, onGetFolder = () => {}, canPickFolder = false, onPreviewCleared = () => {}, loadVariantText = async () => '', groupVariants = () => ({ items: [], drifted: 0 }) } = {}) {
    this.container = container;
    this.session = session;
    this.onSummary = onSummary;
    this.onCollect = onCollect;
    this.onCancel = onCancel;
    this.onOpen = onOpen;
    this.onLoadRecipe = onLoadRecipe;
    this.onClearRecipe = onClearRecipe;
    this.onPreview = onPreview;
    this.onGet = onGet;
    this.onGetFolder = onGetFolder;
    this.canPickFolder = canPickFolder;
    this.onPreviewCleared = onPreviewCleared;
    this.resultMode = null;
    this.openId = null;
    this.rovingId = null;
    this.matrix = null;
    this.loadVariantText = loadVariantText;
    this.groupVariants = groupVariants;
    this.variants = null;
    this.variantsSignature = '';
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
    this.list.addEventListener('keydown', (e) => this.onListKey(e));
    this.list.addEventListener('focusin', (e) => {
      const btn = e.target.closest && e.target.closest('.set-file-open');
      if (btn) this.rovingId = btn.dataset.id;
    });
    this.empty = h('p', { class: 'set-empty item-meta' });
    this.files = h('section', { class: 'set-pane set-files', 'aria-label': S.setFiles }, h('div', { class: 'set-pane-head' }, h('h2', { class: 'set-pane-title' }, S.setFiles), this.count), this.filter, this.list, this.empty);
    this.recipe = h('section', { class: 'set-pane set-recipe', 'aria-label': S.setRecipe, tabindex: 0 }, h('h2', { class: 'set-pane-title' }, S.setRecipe));
    this.recipePanel = new RecipePanel(this.recipe, { onLoad: (file) => this.onLoadRecipe(file), onClear: () => this.onClearRecipe(), onPreview: () => this.onPreview(), onGet: () => this.onGet(), onGetFolder: () => this.onGetFolder(), canPickFolder: this.canPickFolder });
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
    if (this.session.state === 'running' || this.session.state === 'previewing' || this.session.state === 'empty') this.clearResult();
    else if (this.session.state === 'indexing' && this.resultMode === 'preview') this.dropPreview();
    this.root.dataset.mode = this.openId ? 'file' : 'set';
    this.count.textContent = all.length ? S.setCount(shown.length, all.length) : '';
    const focused = this.list.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    clear(this.list);
    for (const f of shown) this.list.append(this.row(f));
    this.settleRoving(focused);
    this.empty.hidden = shown.length > 0;
    this.empty.textContent = all.length === 0 ? S.setEmpty : S.setNoMatch;
    this.filter.hidden = all.length === 0;
    this.renderVariants(all);
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
    this.cancelBtn.hidden = !BUSY.includes(this.session.state);
    this.recipePanel.setState({ locked: BUSY.includes(this.session.state), ready: SETTLED.includes(this.session.state) && counts.ready + counts.edited > 0 });
    this.onSummary(counts);
  }

  row(f) {
    const badge = f.badge || 'pending';
    const note = noteOf(f);
    const dir = splitPath(f.relPath, f.name);
    const main = h('span', { class: 'set-file-main' },
      h('span', { class: 'set-file-name', text: f.name }),
      dir ? h('span', { class: 'set-file-dir item-meta', text: dir }) : null);
    const openable = f.status === 'ready';
    const lead = openable
      ? h('button', { class: 'set-file-open', type: 'button', tabindex: -1, 'data-id': f.id, 'aria-current': f.id === this.openId ? 'true' : null, onclick: () => this.onOpen(f.id) }, main)
      : main;
    return h('li', { class: 'set-file', 'data-id': f.id, 'data-badge': badge },
      lead,
      h('span', { class: 'set-badge', text: BADGE_TEXT[badge] }),
      note ? h('span', { class: 'set-file-note item-meta', text: note }) : null);
  }

  buttons() {
    return [...this.list.querySelectorAll('.set-file-open')];
  }

  settleRoving(focusedId) {
    const buttons = this.buttons();
    if (!buttons.length) return;
    const wanted = buttons.find((b) => b.dataset.id === (focusedId || this.rovingId)) || buttons.find((b) => b.dataset.id === this.openId) || buttons[0];
    wanted.tabIndex = 0;
    if (focusedId && wanted.dataset.id === focusedId) wanted.focus();
  }

  onListKey(e) {
    const buttons = this.buttons();
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, to))];
    for (const b of buttons) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  }

  renderVariants(all) {
    if (this.session.state === 'indexing') return;
    const indexes = all.filter((f) => f.status === 'ready' && f.index).map((f) => f.index);
    const signature = indexes.map((i) => i.id).join(',');
    if (signature === this.variantsSignature) return;
    this.variantsSignature = signature;
    if (!indexes.length) {
      if (this.variants) {
        this.variants.destroy();
        this.variants = null;
      }
      return;
    }
    if (!this.variants) this.variants = new VariantsPanel(this.recipe, { loadText: (item, version) => this.loadVariantText(item, version) });
    this.variants.setData(this.groupVariants(indexes));
    this.variants.root.hidden = this.openId !== null;
  }

  showResult(rows, mode = 'report', { detailFor = null } = {}) {
    this.clearResult();
    this.detailFor = detailFor;
    this.matrix = new ResultMatrix(this.result, { mode, onSelectRow: (i) => this.showDetail(i) });
    this.matrix.setRows(rows);
    this.resultMode = mode;
    this.result.dataset.matrix = 'true';
    this.detail = h('div', { class: 'set-detail' });
    this.result.append(this.detail);
    this.showDetail(-1);
  }

  showDetail(index) {
    if (!this.detail) return;
    clear(this.detail);
    this.detail.hidden = false;
    if (!this.detailFor) {
      this.detail.hidden = true;
      return;
    }
    const d = index >= 0 ? this.detailFor(index) : null;
    if (!d) {
      this.detail.append(h('p', { class: 'row-diff-hint item-meta' }, S.rowDiffHint));
      return;
    }
    const body = d.rename ? h('p', { class: 'row-diff-rename' }, S.rowDiffRename(d.rename.from, d.rename.to)) : diffTable(d.target.name, d.before, d.after);
    this.detail.append(
      h('div', { class: 'row-diff', role: 'region', 'aria-label': S.rowDiffLabel(d.target.name), tabindex: '0' },
        h('p', { class: 'row-diff-title' }, S.rowDiffTitle(d.op, d.target.name, d.file)),
        body));
  }

  setRecipeView(view) {
    this.recipePanel.setView(view);
  }

  dropPreview() {
    this.clearResult();
    this.onPreviewCleared();
  }

  clearPreview() {
    if (this.resultMode === 'preview') this.dropPreview();
  }

  clearResult() {
    if (!this.matrix) return;
    this.matrix.destroy();
    this.matrix = null;
    if (this.detail) this.detail.remove();
    this.detail = null;
    this.detailFor = null;
    this.resultMode = null;
    delete this.result.dataset.matrix;
  }

  get host() {
    return this.recipe;
  }

  openFile(id) {
    this.openId = id;
    this.root.dataset.mode = 'file';
    this.recipe.dataset.hosting = 'true';
    this.recipePanel.root.hidden = true;
    if (this.variants) this.variants.root.hidden = true;
    this.render();
  }

  closeFile() {
    this.openId = null;
    this.root.dataset.mode = 'set';
    delete this.recipe.dataset.hosting;
    this.recipePanel.root.hidden = false;
    if (this.variants) this.variants.root.hidden = false;
    this.render();
  }

  destroy() {
    this.off();
    this.root.remove();
  }
}
