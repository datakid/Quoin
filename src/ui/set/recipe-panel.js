import { h, clear } from '../dom.js';
import { S } from '../strings.js';

const warningText = (w) => (w.code === 'recipe.ignored' ? S.recipeIgnoredBlock(w.path) : S.recipeWarning(w.path));

export class RecipePanel {
  constructor(host, { onLoad, onClear, onPreview, onGet, onGetFolder, canPickFolder = false }) {
    this.view = { loaded: null, warnings: [], error: '', notes: [], canPreview: false, canGet: false };
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
    this.line = h('p', { class: 'recipe-line' }, S.recipeNone);
    this.error = h('p', { class: 'recipe-error', role: 'alert' });
    this.warnings = h('ul', { class: 'recipe-warnings item-meta', 'aria-label': S.recipeWarnings });
    this.notes = h('div', { class: 'recipe-notes item-meta', role: 'status' });
    this.root = h('div', { class: 'recipe-panel' },
      h('div', { class: 'recipe-actions' }, this.loadBtn, this.clearBtn, this.previewBtn, this.getBtn, this.folderBtn, this.input),
      this.line, this.error, this.warnings, this.notes);
    host.append(this.root);
  }

  setView(view) {
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
    this.sync();
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
  }

  restoreFocus() {
    const at = document.activeElement;
    if (!at || at === document.body) this.previewBtn.focus();
  }

  destroy() {
    this.root.remove();
  }
}
