import { h, clear } from '../dom.js';
import { S } from '../strings.js';

const warningText = (w) => (w.code === 'recipe.ignored' ? S.recipeIgnoredBlock(w.path) : w.code === 'recipe.token' ? S.recipeTokenWarning(w.path) : S.recipeWarning(w.path));

const canCopy = () => typeof navigator !== 'undefined' && !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function';

export class RecipePanel {
  constructor(host, { onLoad, onClear, onPreview, onGet, onGetFolder, onSave, onDownload, onUse, onDelete, canPickFolder = false }) {
    this.view = { loaded: null, warnings: [], error: '', notes: [], canPreview: false, canGet: false, stored: [], storedSkipped: 0, tokensUsed: [] };
    this.onUse = onUse;
    this.onDelete = onDelete;
    this.canPickFolder = canPickFolder;
    this.locked = false;
    this.ready = false;
    this.input = h('input', { type: 'file', class: 'sr-only', accept: '.json,application/json', tabindex: '-1', 'aria-label': S.recipeLoadLabel });
    this.input.addEventListener('change', () => {
      const file = this.input.files && this.input.files[0];
      this.input.value = '';
      if (file) onLoad(file);
    });
    this.loadBtn = h('button', { class: 'btn', type: 'button', onclick: () => this.input.click() }, S.recipeLoad);
    this.clearBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => onClear() }, S.recipeClear);
    this.previewBtn = h('button', { class: 'btn btn-primary recipe-preview', type: 'button', disabled: true, onclick: () => onPreview() }, S.recipePreview);
    this.getBtn = h('button', { class: 'btn btn-primary recipe-get', type: 'button', hidden: true, onclick: () => onGet() }, S.recipeGet);
    this.folderBtn = h('button', { class: 'btn recipe-get-folder', type: 'button', hidden: true, onclick: () => onGetFolder() }, S.recipeGetFolder);
    this.saveBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => onSave() }, S.recipeSaveHere);
    this.downloadBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => onDownload() }, S.recipeDownload);
    this.keep = h('div', { class: 'recipe-keep', hidden: true }, this.saveBtn, this.downloadBtn);
    this.storedHead = h('h3', { class: 'recipe-stored-title item-meta' }, S.recipesStored);
    this.storedList = h('ul', { class: 'recipe-stored-list' });
    this.storedNote = h('p', { class: 'recipe-stored-note item-meta', hidden: true });
    this.stored = h('section', { class: 'recipe-stored', 'aria-label': S.recipesStored, hidden: true }, this.storedHead, this.storedList, this.storedNote);
    this.tokenList = h('ul', { class: 'recipe-token-list' });
    this.tokenStatus = h('p', { class: 'recipe-token-status item-meta', role: 'status' });
    this.tokens = h('details', { class: 'recipe-tokens', hidden: true }, h('summary', null, S.recipeTokensTitle), h('p', { class: 'recipe-token-intro item-meta', text: S.recipeTokensIntro }), this.tokenList, this.tokenStatus);
    this.line = h('p', { class: 'recipe-line' }, S.recipeNone);
    this.kept = h('p', { class: 'recipe-kept item-meta', role: 'status', hidden: true });
    this.error = h('p', { class: 'recipe-error', role: 'alert' });
    this.warnings = h('ul', { class: 'recipe-warnings item-meta', 'aria-label': S.recipeWarnings });
    this.notes = h('div', { class: 'recipe-notes item-meta', role: 'status' });
    this.root = h('div', { class: 'recipe-panel' },
      h('div', { class: 'recipe-actions' }, this.loadBtn, this.clearBtn, this.previewBtn, this.getBtn, this.folderBtn, this.input),
      this.line, this.keep, this.kept, this.error, this.warnings, this.notes, this.tokens, this.stored);
    host.append(this.root);
  }

  setKept(text) {
    this.kept.textContent = text;
    this.kept.hidden = !text;
  }

  setView(view) {
    this.setKept('');
    this.view = { ...this.view, ...view };
    const { loaded, warnings, error, notes } = this.view;
    this.line.textContent = loaded ? S.recipeLoaded(loaded.name, S.recipeKind[loaded.kind] || loaded.kind) : S.recipeNone;
    this.error.textContent = error;
    this.error.hidden = !error;
    clear(this.notes);
    for (const n of notes) this.notes.append(h('p', { class: 'recipe-note', text: n }));
    this.notes.hidden = notes.length === 0;
    clear(this.warnings);
    for (const w of warnings) this.warnings.append(h('li', { text: warningText(w) }));
    this.warnings.hidden = warnings.length === 0;
    this.clearBtn.hidden = !loaded;
    this.keep.hidden = !loaded;
    this.saveBtn.hidden = !loaded;
    this.downloadBtn.hidden = !loaded;
    this.tokens.hidden = !loaded;
    this.renderTokens(this.view.tokensUsed);
    this.renderStored(this.view.stored, this.view.storedSkipped);
    this.sync();
  }

  renderTokens(used) {
    clear(this.tokenList);
    this.tokenStatus.textContent = '';
    for (const token of Object.keys(S.recipeTokenWhat)) {
      const head = h('span', { class: 'recipe-token-head' }, h('code', { class: 'recipe-token-name', text: token }));
      if (used.includes(token)) head.append(h('span', { class: 'recipe-token-used', text: S.recipeTokenInUse }));
      const item = h('li', { class: 'recipe-token' }, head, h('span', { class: 'recipe-token-what', text: S.recipeTokenWhat[token] }));
      if (canCopy()) item.append(h('button', { class: 'btn btn-quiet recipe-token-copy', type: 'button', 'aria-label': S.recipeTokenCopy(token), onclick: () => this.copyToken(token) }, S.recipeCopy));
      this.tokenList.append(item);
    }
  }

  copyToken(token) {
    navigator.clipboard.writeText(token).then(() => {
      this.tokenStatus.textContent = S.recipeTokenCopied(token);
    }, () => {
      this.tokenStatus.textContent = '';
    });
  }

  renderStored(stored, skipped) {
    clear(this.storedList);
    for (const r of stored) {
      this.storedList.append(h('li', { class: 'recipe-stored-item', 'data-name': r.name },
        h('span', { class: 'recipe-stored-name', text: `${S.recipeKind[r.kind] || r.kind} · ${r.name}` }),
        h('button', { class: 'btn recipe-use', type: 'button', 'aria-label': S.recipeUseLabel(r.name), onclick: () => this.onUse(r.name) }, S.recipeUse),
        h('button', { class: 'btn recipe-delete', type: 'button', 'aria-label': S.recipeDeleteLabel(r.name), onclick: () => this.deleteStored(r.name) }, S.recipeDelete)));
    }
    this.storedNote.textContent = skipped ? S.recipesSkipped(skipped) : '';
    this.storedNote.hidden = !skipped;
    this.stored.hidden = stored.length === 0 && !skipped;
  }

  deleteStored(name) {
    const items = [...this.storedList.querySelectorAll('.recipe-stored-item')];
    const at = items.findIndex((li) => li.dataset.name === name);
    this.onDelete(name);
    const left = [...this.storedList.querySelectorAll('.recipe-use')];
    const next = left[Math.min(at, left.length - 1)];
    (next || this.loadBtn).focus();
  }

  setState({ locked, ready }) {
    this.locked = locked;
    this.ready = ready;
    this.sync();
  }

  sync() {
    const { canPreview, canGet } = this.view;
    this.previewBtn.disabled = this.locked || !this.ready || !canPreview;
    this.previewBtn.classList.toggle('btn-primary', !canGet);
    this.getBtn.hidden = !canGet;
    this.getBtn.disabled = this.locked || !this.ready;
    this.folderBtn.hidden = !canGet || !this.canPickFolder;
    this.folderBtn.disabled = this.locked || !this.ready;
    this.loadBtn.disabled = this.locked;
    this.clearBtn.disabled = this.locked;
    for (const b of this.storedList.querySelectorAll('button')) b.disabled = this.locked;
  }

  restoreFocus() {
    const at = document.activeElement;
    if (!at || at === document.body) this.previewBtn.focus();
  }

  destroy() {
    this.root.remove();
  }
}
