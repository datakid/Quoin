import { h, clear } from '../ui/dom.js';
import { S, errorMessage, fmt } from '../ui/strings.js';
import { formatsFor } from '../ui/formats.js';
import { markImg, syncMarks, watchMarks } from '../ui/mark.js';
import { hasFilePicker, writeThroughPicker } from './file-save.js';
import { openPrintPreview, printWithoutPreview } from '../ui/print-preview.js';
import { buildRegistry } from './app-commands.js';
import { openPalette } from '../ui/wb/palette.js';
import { outlineModule } from '../core/vba/outline.js';
import { stepsOf } from '../core/wb/steps.js';
import { settingsDialog, shortcutsDialog, detailsDialog, changesDialog, confirmDialog, menu, popover } from '../ui/dialogs.js';
import { Session } from './session.js';
import { Workspace } from './workspace.js';
import { queryFile, moduleFile, zipFiles, sanitizeFileName } from '../core/export/files.js';
import { QuoinError } from '../core/errors.js';
import { SetSession } from './set-session.js';
import { SetShell } from '../ui/set/shell.js';
import { sharedPool } from './pool.js';
import { snapshotDrop, hasFolder, collectFiles, filesFromInput, indexPending } from './intake.js';
import { startCollect } from './collect-run.js';
import { startPlanRun } from './plan-run.js';
import { buildPlanOutput } from './outputs.js';
import { buildFolderOutput, hasDirectoryPicker } from './folder-output.js';
import { parseRecipe } from '../batch/recipe/recipe.js';
import { createVariantTextLoader } from './variant-text.js';
import { groupVariants } from '../batch/verify/variants.js';

const MAX_RECIPE_BYTES = 256 * 1024;
const PREVIEWABLE = ['inject', 'replace', 'align'];

const DEFAULTS = { theme: 'system', density: 'comfortable', culture: 'en-US', timeoutS: 30, rowCap: 1000000, csvGuard: true, useUpstream: false };

function loadTheme() {
  try {
    const t = window.localStorage.getItem('quoin.theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyDensity(d) {
  document.documentElement.classList.toggle('density-compact', d === 'compact');
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  syncMarks();
  try {
    if (t === 'system') window.localStorage.removeItem('quoin.theme');
    else window.localStorage.setItem('quoin.theme', t);
  } catch {
    return;
  }
}

function saveBytes(bytes, name, mime) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const STATUS_INTERVAL_MS = 500;
const WORKBOOK_MIMES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroEnabled.12'
};
const OPENABLE_NAME = /\.(xlsx|xlsm|xltx|xltm|xls|xlsb|ods)$/i;

class Status {
  constructor(el, alertEl) {
    this.el = el;
    this.alertEl = alertEl;
    this.state = { run: null, compare: null, culture: 'en-US', note: '', edits: 0, flags: [], counts: '', alertText: '' };
    this.sig = null;
    this.lastAt = -Infinity;
    this.timer = null;
    this.zw = false;
    this.flush();
  }

  set(partial) {
    if (partial.note && partial.note === this.state.note) this.zw = !this.zw;
    Object.assign(this.state, partial);
    this.schedule();
  }

  describe() {
    const st = this.state;
    const f = formatsFor(st.culture);
    const bits = [];
    let alert = st.alertText || '';
    if (st.run) {
      if (st.run.cancelled) bits.push(S.cancelled);
      else if (st.run.fn) bits.push(S.functionStatus);
      else if (st.run.error) alert = alert || S.errorStatus(st.run.error);
      else if (st.run.rows !== undefined) bits.push(S.runStatus(st.run.rows, st.run.secs, f.integer.format(st.run.rows)));
      else bits.push(S.valueStatus(st.run.secs));
    }
    const items = [{ text: [st.counts, ...bits].filter(Boolean).join(' · ') || ' ' }];
    const c = st.compare;
    if (c) {
      if (c.disabled) items.push({ text: ` · ${c.disabled === 'time' ? S.compareTime : S.compareRandom}` });
      else if (c.reason === 'columns') items.push({ text: ` · ${S.compareColumns}` });
      else if (c.matches) items.push({ text: ` · ${S.matchesCache}`, dot: 'ok' });
      else items.push({ text: ` · ${c.reason === 'rows' ? S.rowCountDiffers(f.integer.format(c.got), f.integer.format(c.expected)) : S.cellsDiffer(f.integer.format(c.count))}`, dot: 'diff' });
    }
    if (st.flags && st.flags.includes('non-deterministic')) items.push({ text: ` · ${S.nonDeterministic}` });
    if (st.note) items.push({ text: ` · ${st.note}${this.zw ? '\u200b' : ''}` });
    items.push({ spacer: true });
    if (st.edits) items.push({ text: S.itemsEdited(st.edits) });
    if (st.culture && st.culture !== 'en-US') items.push({ text: ` · ${st.culture}` });
    return { items, alert };
  }

  schedule() {
    const { items, alert } = this.describe();
    if (alert !== this.alertEl.textContent) this.alertEl.textContent = alert;
    this.syncIdle(items, alert);
    if (JSON.stringify(items) === this.sig) return;
    const wait = STATUS_INTERVAL_MS - (performance.now() - this.lastAt);
    if (wait <= 0) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, wait);
    }
  }

  flush() {
    const { items, alert } = this.describe();
    if (alert !== this.alertEl.textContent) this.alertEl.textContent = alert;
    const sig = JSON.stringify(items);
    if (sig === this.sig) return;
    this.sig = sig;
    this.lastAt = performance.now();
    clear(this.el);
    for (const it of items) {
      if (it.spacer) this.el.append(h('span', { class: 'spacer' }));
      else if (it.dot) this.el.append(h('span', { class: `chip ${it.dot}` }, h('span', { class: `status-dot ${it.dot}` }), it.text.replace(/^ · /, '')));
      else this.el.append(h('span', null, it.text));
    }
    this.syncIdle(items, alert);
  }

  syncIdle(items, alert) {
    const idle = !alert && items.every((it) => it.spacer || !it.text || !it.text.trim());
    if (this.el.parentElement) this.el.parentElement.classList.toggle('is-idle', idle);
  }
}

export class App {
  constructor(root) {
    this.root = root;
    this.settings = { ...DEFAULTS, theme: loadTheme() };
    this.faultInject = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('selfcheck') === 'fail';
    this.session = new Session();
    this.set = new SetSession();
    this.shell = null;
    this.fromSet = null;
    this.recipeHeld = null;
    this.preview = null;
    this.build();
    this.bindGlobal();
    this.set.subscribe(() => {
      if (!this.ws && !this.shell && this.set.state !== 'empty') this.showSet();
    });
  }

  build() {
    this.registry = buildRegistry(this);
    this.fileHead = h('span', { class: 'fn-head' });
    this.fileTail = h('span', { class: 'fn-tail' });
    this.backBtn = h('button', { class: 'btn btn-quiet back-button', type: 'button', onclick: () => this.backToSet() }, S.setBack);
    this.fileBtn = h('button', { class: 'file-name', type: 'button', hidden: true, onclick: () => this.showDetails() }, this.fileHead, this.fileTail);
    this.fileMeta = h('span', { class: 'file-meta item-meta', hidden: true });
    this.paletteBtn = h('button', { class: 'btn btn-quiet palette-button', type: 'button', hidden: true, 'aria-keyshortcuts': 'Control+K Meta+K', onclick: () => this.openPalette() }, S.palette.trigger, h('span', { class: 'kbd', 'aria-hidden': 'true' }, S.palette.kbd));
    this.printBtn = h('button', { class: 'btn print-button', type: 'button', hidden: true, onclick: () => this.openPrint() }, S.print);
    this.exportBtn = h('button', { class: 'btn', type: 'button', hidden: true, 'aria-haspopup': 'menu', 'aria-expanded': false, onclick: () => this.openExport() }, S.export);
    this.settingsBtn = h('button', { class: 'btn btn-quiet', type: 'button', 'aria-label': S.settings, title: S.settings, onclick: () => this.openSettings() }, '⚙');
    this.downloadCount = h('span', { class: 'dl-count' });
    this.downloadBtn = h('button', { class: 'btn', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': false, 'aria-disabled': true, title: S.downloadNone, onclick: () => this.openDownload() }, S.download, this.downloadCount);
    this.topbar = h('header', { class: 'topbar' },
      h('h1', { class: 'brand' }, markImg('brand-mark', 28), h('span', { class: 'wordmark' }, S.appName)),
      this.fileBtn, this.fileMeta, h('span', { class: 'spacer' }), this.paletteBtn, this.printBtn, this.exportBtn, this.settingsBtn, this.downloadBtn);
    this.input = h('input', { type: 'file', class: 'sr-only', accept: '.xlsx,.xlsm,.xltx,.xltm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tabindex: '-1', 'aria-label': S.chooseFile });
    this.input.addEventListener('change', () => {
      if (this.input.files && this.input.files[0]) this.openFile(this.input.files[0]);
      this.input.value = '';
    });
    this.folderInput = h('input', { type: 'file', class: 'sr-only', multiple: true, webkitdirectory: true, tabindex: -1, 'aria-hidden': 'true' });
    this.folderInput.addEventListener('change', () => {
      const refs = filesFromInput(this.folderInput.files || []);
      this.folderInput.value = '';
      this.addToSet(refs);
    });
    this.mainEl = h('main', { class: 'content' });
    this.mainEl.style.minHeight = '0';
    this.mainEl.style.display = 'grid';
    this.statusEl = h('div', { class: 'status-main', id: 'status', role: 'status', 'aria-live': 'polite' });
    this.alertEl = h('div', { class: 'status-alert', id: 'alert', role: 'alert' });
    this.barEl = h('div', { class: 'statusbar' }, this.statusEl, this.alertEl);
    this.status = new Status(this.statusEl, this.alertEl);
    this.root.append(this.input, this.folderInput, this.topbar, this.mainEl, this.barEl);
    this.root.classList.add('app');
    this.showEmpty();
  }

  showSet() {
    clear(this.mainEl);
    this.ws = null;
    this.zone = null;
    this.fileBtn.hidden = true;
    this.paletteBtn.hidden = true;
    this.printBtn.hidden = true;
    this.exportBtn.hidden = true;
    this.downloadBtn.hidden = true;
    this.fileMeta.hidden = false;
    this.shell = new SetShell(this.mainEl, this.set, {
      onSummary: (c) => {
        if (this.fromSet) return;
        this.fileMeta.textContent = S.setSummary(c.files, c.queries);
        document.title = S.setTitle(c.files);
      },
      onCollect: () => this.collectSet(),
      onCancel: () => this.cancelSetRun(),
      onOpen: (id) => this.openFromSet(id),
      onLoadRecipe: (file) => this.loadRecipeFile(file),
      onClearRecipe: () => this.clearRecipe(),
      onPreview: () => this.previewRecipe(),
      onGet: () => this.getRecipe({ folder: false }),
      onGetFolder: () => this.getRecipe({ folder: true }),
      canPickFolder: hasDirectoryPicker(),
      onPreviewCleared: () => this.forgetPreview(),
      loadVariantText: (item, version) => this.variantText(item, version),
      groupVariants
    });
    this.showRecipe(this.recipeView());
  }

  unmountShell() {
    if (!this.shell) return;
    this.preview = null;
    this.shell.destroy();
    this.shell = null;
    document.title = S.appName;
  }

  showEmpty(message) {
    this.unmountShell();
    clear(this.mainEl);
    this.ws = null;
    this.fileBtn.hidden = true;
    this.fileMeta.hidden = true;
    this.paletteBtn.hidden = true;
    this.printBtn.hidden = true;
    this.exportBtn.hidden = true;
    this.downloadBtn.hidden = true;
    this.zone = h('div', { class: 'dropzone' }, h('p', { class: 'item-meta' }, S.emptyPrompt), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.input.click() }, S.chooseFile));
    this.mainEl.append(h('div', { class: 'empty' }, h('div', { class: 'empty-inner' },
      markImg('mark', 64),
      h('h2', null, S.tagline),
      message ? h('div', { class: 'message error', role: 'alert' }, message) : null,
      this.zone,
      h('p', { class: 'footnote' }, S.emptyFoot))));
  }

  bindGlobal() {
    this.installPrintFallback();
    this.dragDepth = 0;
    const setOver = (on) => {
      if (this.zone) this.zone.classList.toggle('is-over', on);
    };
    window.addEventListener('dragenter', (ev) => {
      ev.preventDefault();
      this.dragDepth++;
      setOver(true);
    });
    window.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      setOver(true);
    });
    window.addEventListener('dragleave', () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) setOver(false);
    });
    window.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.dragDepth = 0;
      setOver(false);
      this.handleDrop(ev.dataTransfer);
    });
    this.leaveGuard = (ev) => {
      ev.preventDefault();
      ev.returnValue = S.unsavedLeave;
    };
    this.guarding = false;
    window.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  refuse(text) {
    if (this.ws || this.shell) this.status.set({ alertText: text });
    else this.showEmpty(text);
  }

  handleDrop(dt) {
    if (!dt) return;
    const first = dt.items && dt.items[0];
    const handle = first && typeof first.getAsFileSystemHandle === 'function' ? first.getAsFileSystemHandle().catch(() => null) : null;
    const snapshot = snapshotDrop(dt);
    const files = snapshot.files;
    if (this.ws) {
      if (hasFolder(snapshot)) this.refuse(S.dropFolder);
      else if (files.length > 1) this.refuse(S.dropOne);
      else if (files.length === 1) this.openFile(files[0], handle);
    } else if (files.length === 1 && !hasFolder(snapshot)) this.openFile(files[0], handle);
    else if (files.length > 0 || hasFolder(snapshot)) this.collectIntoSet(snapshot);
  }

  async collectIntoSet(snapshot) {
    const { files, unreadable } = await collectFiles(snapshot);
    this.addToSet(files, unreadable);
  }

  addToSet(refs, unreadable = []) {
    if (!refs.length && !unreadable.length) return;
    try {
      this.set.addFiles(refs);
    } catch {
      this.status.set({ alertText: S.setBusy });
      return;
    }
    if (unreadable.length) this.status.set({ alertText: S.unreadableItems(unreadable.length) });
    indexPending(this.set, sharedPool());
  }

  variantText(item, version) {
    if (!this.variantLoader) {
      const now = new Date().toISOString();
      this.variantLoader = createVariantTextLoader({ pool: sharedPool(), session: this.set, now, runId: `v${now}` });
    }
    return this.variantLoader(item, version);
  }

  openFromSet(id) {
    const rec = this.set.file(id);
    if (!rec || rec.status !== 'ready' || (this.fromSet === id && this.ws)) return;
    this.openFile(rec.file, null, id);
  }

  syncSetMarker() {
    if (this.fromSet) this.set.setEdited(this.fromSet, this.session.isDirty());
  }

  async backToSet() {
    if (!this.fromSet || !this.shell) return;
    if (this.session.editCount > 0 && !(await confirmDialog({ title: S.setBackTitle, body: S.setBackBody(this.session.editCount), confirmLabel: S.setBackConfirm, cancelLabel: S.setBackKeep }))) return;
    const id = this.fromSet;
    this.set.setEdited(id, false);
    this.fromSet = null;
    if (this.ws) {
      this.ws.runner.stop({ type: 'result', status: 'cancelled' });
      this.ws.root.remove();
    }
    this.ws = null;
    this.session = new Session();
    this.status.set({ run: null, compare: null, note: '', edits: 0, counts: '', alertText: '' });
    this.backBtn.remove();
    for (const el of [this.fileBtn, this.paletteBtn, this.printBtn, this.exportBtn, this.downloadBtn]) el.hidden = true;
    this.syncLeaveGuard();
    this.shell.closeFile();
    this.fileMeta.hidden = false;
  }

  collectSet() {
    if (this.setRun) return this.setRun.promise;
    const now = new Date().toISOString();
    let run;
    try {
      run = startCollect({ session: this.set, pool: sharedPool(), now, runId: `r${now}` });
    } catch {
      this.status.set({ alertText: S.setBusy });
      return Promise.resolve(null);
    }
    this.setRun = run;
    return run.promise.then((out) => {
      if (this.setRun === run) this.setRun = null;
      if (out.ok) {
        saveBytes(out.bytes, out.name, 'application/zip');
        if (this.shell) this.shell.showResult(out.rows, 'report');
      }
      else if (out.code) this.status.set({ alertText: errorMessage(out.code) });
      return out;
    });
  }

  cancelSetRun() {
    if (!this.setRun) return;
    this.setRun.cancel();
    this.setRun = null;
  }

  showRecipe(view) {
    if (this.shell) this.shell.setRecipeView(view);
  }

  recipeView(extra = {}) {
    const held = this.recipeHeld;
    if (!held) return { loaded: null, warnings: [], error: '', notes: [], canPreview: false, canGet: false, ...extra };
    const previewable = PREVIEWABLE.includes(held.recipe.recipe);
    const canGet = previewable && !!this.preview && this.preview.counts.changed > 0;
    return { loaded: { name: held.name, kind: held.recipe.recipe }, warnings: held.warnings, error: '', notes: previewable ? [] : [S.recipeNotPreviewable], canPreview: previewable, canGet, ...extra };
  }

  forgetPreview() {
    this.preview = null;
    this.showRecipe(this.recipeView());
  }

  async loadRecipeFile(file) {
    this.recipeHeld = null;
    this.preview = null;
    if (this.shell) this.shell.clearPreview();
    if (file.size > MAX_RECIPE_BYTES) return this.showRecipe(this.recipeView({ error: S.recipeTooLarge }));
    let text;
    try {
      text = await file.text();
    } catch {
      return this.showRecipe(this.recipeView({ error: S.recipeUnreadable }));
    }
    const parsed = parseRecipe(text);
    if (!parsed.ok) return this.showRecipe(this.recipeView({ error: errorMessage(parsed.code, { detail: parsed.detail }) }));
    this.recipeHeld = { name: file.name, recipe: parsed.recipe, warnings: parsed.warnings };
    this.showRecipe(this.recipeView());
  }

  clearRecipe() {
    this.recipeHeld = null;
    this.preview = null;
    if (this.shell) this.shell.clearPreview();
    this.showRecipe(this.recipeView());
  }

  planProblem(out) {
    if (out.code !== 'plan.invalid' || !out.errors.length) return errorMessage(out.code, { count: out.count });
    const first = out.errors[0];
    const text = errorMessage(first.code, { token: first.detail });
    return out.errors.length > 1 ? `${text} ${S.recipePlanMore(out.errors.length - 1)}` : text;
  }

  async getRecipe({ folder }) {
    const held = this.recipeHeld;
    const preview = this.preview;
    if (!held || !preview || this.setRun || !this.shell) return null;
    let confirmSignatures = false;
    if (preview.signedCount > 0) {
      confirmSignatures = await confirmDialog({ title: S.signedTitle, body: S.signedBody(preview.signedCount), confirmLabel: S.signedConfirm, cancelLabel: S.signedBack });
      if (!confirmSignatures) return null;
    }
    let root = null;
    if (folder) {
      try {
        root = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (!e || e.name !== 'AbortError') this.showRecipe(this.recipeView({ error: S.folderUnavailable }));
        return null;
      }
    }
    const now = new Date().toISOString();
    const build = (result, hooks) => (folder ? buildFolderOutput(root, result, hooks) : buildPlanOutput(result));
    let run;
    try {
      run = startPlanRun({ session: this.set, pool: sharedPool(), recipe: held.recipe, now: preview.now, runId: `g${now}`, mode: 'run', preview, confirmSignatures, loadAlignText: (item, version) => this.variantText(item, version), build });
    } catch {
      this.status.set({ alertText: S.setBusy });
      return null;
    }
    this.setRun = run;
    return run.promise.then((out) => {
      if (this.setRun === run) this.setRun = null;
      if (!this.shell || out.cancelled) return out;
      if (!out.ok) {
        if (out.code === 'plan.stale' || out.code === 'plan.invalid') this.preview = null;
        this.showRecipe(this.recipeView({ error: this.planProblem(out) }));
        this.shell.recipePanel.restoreFocus();
        return out;
      }
      const output = out.output;
      if (!folder) saveBytes(output.bytes, output.name, 'application/zip');
      this.preview = null;
      this.shell.showResult(output.rows, 'report');
      const notes = [S.recipeResult(out.counts), folder ? S.recipeGotFolder(output.name, output.files.length) : S.recipeGotZip(output.name)];
      if (out.defect) {
        notes.push(S.runDefect(out.diverged.length));
        this.status.set({ alertText: S.runDefect(out.diverged.length) });
      }
      this.showRecipe(this.recipeView({ notes }));
      this.shell.recipePanel.restoreFocus();
      return out;
    });
  }

  previewRecipe() {
    const held = this.recipeHeld;
    if (!held || this.setRun || !this.shell) return Promise.resolve(null);
    const now = new Date().toISOString();
    let run;
    try {
      if (this.set.state !== 'ready') {
        this.set.beginChoose();
        this.set.endChoose();
      }
      run = startPlanRun({ session: this.set, pool: sharedPool(), recipe: held.recipe, now, runId: `p${now}`, mode: 'preview', loadAlignText: (item, version) => this.variantText(item, version) });
    } catch {
      this.status.set({ alertText: S.setBusy });
      return Promise.resolve(null);
    }
    this.preview = null;
    this.showRecipe(this.recipeView());
    this.setRun = run;
    return run.promise.then((out) => {
      if (this.setRun === run) this.setRun = null;
      if (!this.shell || out.cancelled) return out;
      if (out.ok) {
        this.preview = out;
        this.shell.showResult(out.rows, 'preview');
        this.showRecipe(this.recipeView({ notes: [S.recipeCounts(out.counts), ...(out.signedCount ? [S.recipeSigned(out.signedCount)] : [])] }));
      } else {
        this.showRecipe(this.recipeView({ error: this.planProblem(out) }));
      }
      this.shell.recipePanel.restoreFocus();
      return out;
    });
  }

  chooseFolder() {
    this.folderInput.click();
  }

  async openPrint() {
    if (!this.ws || this.printView) return;
    await openPrintPreview(this, this.printBtn);
  }

  installPrintFallback() {
    window.addEventListener('beforeprint', () => {
      if (this.printView || !this.ws) return;
      this.tempPrint = printWithoutPreview(this);
      if (this.tempPrint) document.body.append(this.tempPrint);
    });
    window.addEventListener('afterprint', () => {
      if (this.tempPrint) {
        this.tempPrint.remove();
        this.tempPrint = null;
      }
    });
  }

  syncDownload() {
    const n = this.session.editCount;
    this.downloadBtn.setAttribute('aria-disabled', String(n === 0));
    if (n === 0) this.downloadBtn.setAttribute('title', S.downloadNone);
    else this.downloadBtn.removeAttribute('title');
    this.downloadCount.textContent = n === 0 ? '' : S.downloadCount(n);
  }

  syncLeaveGuard() {
    const dirty = this.session.editCount > 0;
    if (dirty === this.guarding) return;
    this.guarding = dirty;
    if (dirty) window.addEventListener('beforeunload', this.leaveGuard);
    else window.removeEventListener('beforeunload', this.leaveGuard);
  }

  onKey(ev) {
    if (this.printView) return;
    if (ev.key !== 'Escape' && document.querySelector('dialog[open]')) return;
    const cmd = this.registry.dispatch(ev, this);
    if (!cmd) return;
    const r = cmd.run(this);
    if (cmd.id !== 'shortcuts' && r !== false) ev.preventDefault();
  }

  openShortcuts() {
    shortcutsDialog([...this.registry.sheet(), ...S.shortcutNotes]);
  }

  openPalette(initial = '') {
    const ws = this.ws;
    const lineOf = (text, at) => text.slice(0, at).split(/\r\n|\r|\n/).length;
    let procs = null;
    const source = {
      items: () => (ws ? ws.items() : []),
      commands: () => this.registry.list(this),
      procedures: () => {
        if (procs) return procs;
        procs = [];
        if (ws) {
          for (const m of this.session.modules) {
            const kind = m.kind === 'standard' || m.kind === 'class' ? m.kind : 'document';
            for (const p of outlineModule(this.session.textOf({ type: 'module', name: m.name }), { moduleKind: kind }).procedures) procs.push({ name: p.name, module: m.name, line: p.startLine });
          }
        }
        return procs;
      },
      steps: () => {
        if (!ws || !ws.item || ws.item.type !== 'query') return [];
        const text = ws.editor.getText();
        return stepsOf(text, 0).steps.map((st) => ({ name: st.name, line: lineOf(text, st.span.start) }));
      }
    };
    openPalette(source, {
      initial,
      onItem: (item) => ws.select(item),
      onCommand: (c) => {
        const cmd = this.registry.get(c.id);
        if (cmd && cmd.run) cmd.run(this);
      },
      onProcedure: (p) => {
        ws.select({ type: 'module', name: p.module });
        ws.editor.goto(p.line, 1);
      },
      onStep: (st) => ws.editor.goto(st.line, 1),
      onLine: (n) => ws.editor.goto(n, 1)
    });
  }

  async openFile(file, handlePromise, setId = null) {
    if (!OPENABLE_NAME.test(file.name)) {
      this.refuse(S.dropType);
      return;
    }
    if (this.session.editCount > 0 && !(await confirmDialog({ title: S.discardTitle, body: S.discardBody(this.session.editCount), confirmLabel: S.discard }))) return;
    const next = new Session();
    this.status.set({ run: null, compare: null, note: '', edits: 0, counts: '', alertText: '' });
    try {
      await next.open(file);
    } catch (e) {
      const code = e instanceof QuoinError ? e.code : 'read';
      this.showEmpty(errorMessage(code));
      return;
    }
    next.sourceHandle = handlePromise ? await handlePromise : null;
    this.session = next;
    this.settings = { ...this.settings };
    if (this.ws) this.ws.runner.stop({ type: 'result', status: 'cancelled' });
    const inSet = setId !== null && !!this.shell;
    if (inSet) {
      if (this.ws) this.ws.root.remove();
      this.shell.openFile(setId);
    } else {
      this.unmountShell();
      clear(this.mainEl);
    }
    if (this.fromSet && this.fromSet !== setId) this.set.setEdited(this.fromSet, false);
    this.fromSet = inSet ? setId : null;
    if (inSet) this.fileBtn.before(this.backBtn);
    else this.backBtn.remove();
    this.ws = new Workspace(inSet ? this.shell.host : this.mainEl, this.session, this.settings, this.status);
    this.ws.onEdit(() => {
      this.status.set({ edits: this.session.editCount });
      this.syncDownload();
      this.syncLeaveGuard();
      this.syncSetMarker();
    });
    this.syncDownload();
    this.syncLeaveGuard();
    this.syncSetMarker();
    const dot = file.name.lastIndexOf('.');
    const split = dot > 0 ? dot : file.name.length;
    this.fileHead.textContent = file.name.slice(0, split);
    this.fileTail.textContent = file.name.slice(split);
    this.fileBtn.hidden = false;
    this.fileMeta.textContent = S.fileMeta(file.size);
    this.fileMeta.hidden = false;
    this.paletteBtn.hidden = false;
    this.printBtn.hidden = false;
    this.exportBtn.hidden = false;
    this.downloadBtn.hidden = false;
    this.status.set({ counts: S.fileCounts(next.queries.length, next.modules.length) });
    this.ws.renderRail();
    this.ws.selectFirst();
    this.ws.focusRail();
    this.announceWarnings();
    document.title = S.titleWithApp(file.name);
  }

  announceWarnings() {
    const w = this.session.wb.warnings.map((x) => x.code);
    if (w.length) this.status.set({ note: `${S.noticePrefix}${[...new Set(w)].join(', ')}` });
  }

  showDetails() {
    const wb = this.session.wb;
    detailsDialog([
      [S.filePrefix, wb.fileName],
      [S.fileSize, S.sizeKb(this.session.size)],
      [S.fileFormat, wb.format],
      [S.fileSheets, String(wb.sheets.length)],
      [S.fileTables, String(wb.tables.length)],
      [S.fileQueries, String(wb.queries.length)],
      [S.fileModules, String(this.session.modules.length)]
    ]);
  }

  openSettings() {
    settingsDialog(this.settings, (next) => {
      Object.assign(this.settings, next);
      applyTheme(next.theme);
      applyDensity(next.density);
      if (this.ws) this.ws.grid.remeasure();
      this.status.set({ culture: next.culture });
      if (this.ws) {
        this.ws.settings = this.settings;
        this.ws.applyCulture();
      }
    });
  }

  openDownload() {
    const s = this.session;
    if (s.editCount === 0) return;
    const qn = s.queryEdits.size;
    const mn = s.moduleEdits.size;
    const signed = !!(s.wb.vba && s.wb.vba.signed) && mn > 0;
    const refresh = h('input', { type: 'checkbox', id: 'dl-refresh', checked: true });
    const ack = h('input', { type: 'checkbox', id: 'dl-ack' });
    const msg = h('p', { class: 'warn', role: 'alert', hidden: true });
    const blocked = s.vbaProblems();
    const firstBlocked = blocked.size ? [...blocked][0] : null;
    const go = h('button', { class: 'btn btn-primary', type: 'button', disabled: qn + mn === 0 || signed || blocked.size > 0 }, S.download);
    const content = h('div', { class: 'popover-body' },
      h('p', null, qn + mn === 0 ? S.downloadNone : S.changedSummary(qn, mn)),
      qn ? h('label', { class: 'check', for: 'dl-refresh' }, refresh, S.refreshOnOpen) : null,
      qn ? h('p', { class: 'note' }, S.cacheNote) : null,
      firstBlocked ? h('p', { class: 'warn', role: 'alert' }, S.vbaBlocked(firstBlocked[0], errorMessage(firstBlocked[1][0].code, firstBlocked[1][0]))) : null,
      signed ? h('p', { class: 'warn' }, S.signedNote) : null,
      signed ? h('label', { class: 'check', for: 'dl-ack' }, ack, S.understand) : null,
      msg,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
        pop.close();
        this.openChanges();
      } }, S.reviewChanges), go));
    const pop = popover(this.downloadBtn, content, null, S.download);
    ack.addEventListener('change', () => {
      go.disabled = !ack.checked || qn + mn === 0 || blocked.size > 0;
    });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const res = await s.download({ refreshOnLoad: refresh.checked, acknowledgeSignature: ack.checked, faultInject: this.faultInject });
        const saved = await this.saveWorkbook(res.bytes);
        if (!saved) {
          go.disabled = false;
          return;
        }
        pop.close();
      } catch (e) {
        const code = e instanceof QuoinError ? e.code : 'write.selfcheck';
        msg.hidden = false;
        clear(msg);
        msg.append(code.startsWith('m.parse') ? e.message.replace(/^m\.parse: /, '') : errorMessage(code === 'vba.codepage' ? 'vba.codepage' : code, { cp: e.part || '' }), ' ', h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => navigator.clipboard && navigator.clipboard.writeText(`${code} ${e.message}`) }, S.copyDetails));
        go.disabled = false;
      }
    });
    (qn + mn === 0 ? content : go).focus && go.focus();
  }

  async saveWorkbook(bytes) {
    const s = this.session;
    const name = s.suggestedName();
    const mime = WORKBOOK_MIMES[name.slice(name.lastIndexOf('.') + 1)] || WORKBOOK_MIMES.xlsx;
    if (hasFilePicker()) {
      const out = await writeThroughPicker({
        bytes,
        name,
        mime,
        extension: name.slice(name.lastIndexOf('.') + 1),
        description: S.workbookFileType,
        sourceHandle: s.sourceHandle,
        confirmReplace: (n) => confirmDialog({ title: S.replaceTitle, body: S.replaceBody(n), confirmLabel: S.replaceConfirm, cancelLabel: S.chooseAnotherName })
      });
      if (!out) return false;
      this.status.set({ note: S.savedTo(out.name) });
      return true;
    }
    saveBytes(bytes, name, mime);
    this.status.set({ note: S.downloaded(name) });
    return true;
  }

  openChanges() {
    changesDialog(this.session.changes(), {
      onRevertAll: async () => {
        const n = this.session.editCount;
        const ok = await confirmDialog({ title: S.revertAllTitle, body: S.revertAllBody(n), confirmLabel: S.revertAll });
        if (!ok) {
          this.openChanges();
          return;
        }
        this.ws.revertAll();
        this.status.set({ note: S.revertedAll });
      }
    });
  }

  async exportResult(format, ext) {
    const res = await this.ws.runner.export(format, { guard: this.settings.csvGuard });
    if (res.error || !res.bytes) return;
    saveBytes(res.bytes, sanitizeFileName(this.ws.item.name, ext), res.mime);
  }

  codeFiles(kind) {
    const s = this.session;
    const files = [];
    if (kind === 'queries' || kind === 'all') for (const q of s.queries) files.push({ ...queryFile(q.name, s.textOf({ type: 'query', name: q.name })), name: `queries/${queryFile(q.name, '').name}` });
    if (kind === 'modules' || kind === 'all') {
      const cp = s.wb.vba && s.wb.vba.project ? s.wb.vba.project.codePage : 1252;
      for (const m of s.modules) files.push({ ...moduleFile(m, s.composeModule(m.name), cp), name: `modules/${moduleFile(m, '', cp).name}` });
    }
    return files;
  }

  openExport() {
    const ws = this.ws;
    const item = ws.item;
    const s = this.session;
    const tbl = ws.hasTableResult;
    const entries = [
      { heading: true, label: S.exportResult },
      { label: S.exportCsv, run: () => this.exportResult('csv', '.csv'), disabled: !tbl },
      { label: S.exportCsvBom, run: () => this.exportResult('csvbom', '.csv'), disabled: !tbl },
      { label: S.exportTsv, run: () => this.exportResult('tsv', '.tsv'), disabled: !tbl },
      { label: S.exportJson, run: () => this.exportResult('json', '.json'), disabled: !ws.hasValueResult },
      { label: S.exportXlsx, run: () => this.exportResult('xlsx', '.xlsx'), disabled: !tbl },
      { heading: true, label: S.exportCode },
      { label: S.exportQuery, run: () => this.saveCode(item), disabled: !item || item.type !== 'query' },
      { label: S.exportQueries, run: () => this.saveZip('queries'), disabled: !s.queries.length },
      { label: S.exportModule, run: () => this.saveCode(item), disabled: !item || item.type !== 'module' },
      { label: S.exportModules, run: () => this.saveZip('modules'), disabled: !s.modules.length },
      { label: S.exportEverything, run: () => this.saveZip('all'), disabled: !s.queries.length && !s.modules.length },
      { heading: true, label: S.print },
      { label: S.printPreviewTitle, run: () => this.openPrint() },
      { heading: true, label: S.exportSettings },
      { check: this.settings.csvGuard, id: 'guard', label: S.csvGuardLabel, onToggle: (v) => {
        this.settings.csvGuard = v;
      } }
    ];
    menu(this.exportBtn, entries);
  }

  saveCode(item) {
    const s = this.session;
    if (item.type === 'query') {
      const f = queryFile(item.name, s.textOf(item));
      saveBytes(f.data, f.name, 'text/plain');
    } else {
      const m = s.module(item.name);
      const cp = s.wb.vba.project.codePage;
      const f = moduleFile(m, s.composeModule(item.name), cp);
      saveBytes(f.data, f.name, 'text/plain');
    }
  }

  async saveZip(kind) {
    const files = this.codeFiles(kind);
    const bytes = await zipFiles(files);
    const base = (this.session.wb.fileName || 'workbook').replace(/\.[^.]*$/, '');
    saveBytes(bytes, sanitizeFileName(`${base} ${kind === 'all' ? 'code' : kind}.zip`, '.zip'), 'application/zip');
  }
}

export function boot() {
  applyTheme(loadTheme());
  watchMarks();
  const root = document.getElementById('app');
  const app = new App(root);
  window.__quoin = app;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => undefined);
  }
  return app;
}

export { fmt };
