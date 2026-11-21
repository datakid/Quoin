import { h, clear, svgImg } from '../ui/dom.js';
import { S, fmt, errorMessage } from '../ui/strings.js';
import { Editor } from '../ui/editor.js';
import { Grid, cellDisplay } from '../ui/grid.js';
import { popover, bindingDialog, differencesDialog, confirmDialog } from '../ui/dialogs.js';
import { StepsPanel } from '../ui/wb/steps-panel.js';
import { OutlinePanel } from '../ui/wb/outline-panel.js';
import { DepsPanel } from '../ui/wb/deps-panel.js';
import { openGraph } from '../ui/wb/graph-view.js';
import { upstreamOf, downstreamOf } from '../core/wb/deps.js';
import { impactOf } from '../core/wb/graph-layout.js';
import { outlineModule } from '../core/vba/outline.js';
import { pqLinksOfModule, resolveLinks, runPlanOf, refreshedBy } from '../core/vba/pq-links.js';
import { matchProcedures, revertProcedure } from '../core/vba/proc-diff.js';
import { openProblems } from '../ui/wb/problems-dialog.js';
import { openFind } from '../ui/wb/find-dialog.js';
import { problemsForQuery, problemsForModule, sortProblems, countProblems } from '../core/wb/problems.js';
import { sourcesOfSection } from '../core/wb/sources.js';
import { supportedNames } from '../core/wb/lib-names.js';
import { stepsOf } from '../core/wb/steps.js';
import { Navigator } from '../ui/wb/navigator.js';
import { canMove, moveStep, renameStep, deleteStep, bypassStep, unbypassStep, duplicateStep } from '../core/wb/let-edit.js';
import { parseExpressionText, MParseError } from '../core/m/parser.js';
import { readTable } from '../core/cells.js';
import { formatsFor } from '../ui/formats.js';
import { Runner } from './runner.js';
import { Orchestrator, previewFor } from './orchestrator.js';

function loadLabel(load) {
  if (load.kind === 'table') return `${S.loadedToTable} · ${load.sheet}!${load.ref}${load.alsoModel ? ` · ${S.loadedToModel}` : ''}`;
  if (load.kind === 'model') return S.loadedToModel;
  return S.connectionOnly;
}

export class Workspace {
  constructor(host, session, settings, status) {
    this.session = session;
    this.settings = settings;
    this.status = status;
    this.runner = new Runner();
    this.item = null;
    this.rail = h('nav', { class: 'rail', id: 'rail', 'aria-label': S.itemsAria });
    this.railOpen = false;
    this.main = h('section', { class: 'main', 'data-pane': 'code' });
    this.inspector = h('aside', { class: 'inspector', 'aria-label': S.stepsPanel.aria });
    this.root = h('div', { class: 'workspace', 'data-rail': 'closed', 'data-inspector': 'open', 'data-kind': 'query' }, this.rail, this.main, this.inspector);
    this.rail.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.railOpen) {
        ev.stopPropagation();
        this.setRailOpen(false, true);
      }
    });
    host.append(this.root);
    this.buildMain();
    this.orchestrator = new Orchestrator({
      runner: this.runner,
      context: () => ({
        sectionText: this.session.currentSectionText(),
        textOf: (n) => this.session.textOf({ type: 'query', name: n }),
        culture: this.settings.culture,
        askBinding: (kind, key) => this.askBinding(kind, key)
      }),
      prepare: async () => {
        const snapshot = await this.session.snapshot();
        const set = this.settings;
        return {
          snapshot,
          bindings: [...this.session.bindings].map(([k, b]) => [k, { bytes: b.bytes, workbook: b.workbook }]),
          limits: { timeoutMs: set.timeoutS * 1000, maxRows: set.rowCap },
          useUpstream: set.useUpstream,
          previewRows: 200,
          now: new Date().toISOString(),
          localOffsetMin: -new Date().getTimezoneOffset()
        };
      }
    });
    this.orchestrator.on((e) => this.onBatchEvent(e));
    this.problemRows = [];
    this.problemsRun = 0;
    this.lastRunErrors = new Map();
    this.onProblems = null;
    this.stepResults = new Map();
    this.stepsHost = h('div', { class: 'inspector-section steps-host' });
    this.outlineHost = h('div', { class: 'inspector-section outline-host' });
    this.inspector.append(this.stepsHost, this.outlineHost);
    this.stepsPanel = new StepsPanel(this.stepsHost, this.stepActions());
    this.depsPanel = new DepsPanel(this.stepsHost, { open: (n) => this.select({ type: 'query', name: n }), graph: () => this.openGraph() });
    this.outlinePanel = new OutlinePanel(this.outlineHost, {
      go: (line) => this.editor.goto(line, 1),
      revert: (key, name) => this.revertProc(key, name, false),
      putBack: (key, name) => this.revertProc(key, name, true),
      runLinked: (name, names) => this.runLinked(name, names)
    });
    this.drillStack = [];
    this.lastRun = null;
    this.cachedCompare = new Map();
    this.runToken = 0;
    this.onEditCallbacks = [];
    this.resizer();
    this.editor.textarea.addEventListener('keyup', () => this.syncCaretStep());
    this.editor.textarea.addEventListener('mouseup', () => this.syncCaretStep());
  }

  onEdit(fn) {
    this.onEditCallbacks.push(fn);
  }

  resizer() {
    const handle = h('div', { class: 'rail-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': S.resizeRail, 'aria-valuemin': '220', 'aria-valuemax': '420', 'aria-valuenow': '272', tabindex: '0' });
    this.rail.append(handle);
    let startX = 0;
    let startW = 272;
    const move = (ev) => {
      const w = Math.max(220, Math.min(420, startW + ev.clientX - startX));
      this.root.style.setProperty('--rail-width', `${w}px`);
      handle.setAttribute('aria-valuenow', String(Math.round(w)));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointerdown', (ev) => {
      startX = ev.clientX;
      startW = this.rail.getBoundingClientRect().width;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        const w = Math.max(220, Math.min(420, this.rail.getBoundingClientRect().width + (ev.key === 'ArrowRight' ? 16 : -16)));
        this.root.style.setProperty('--rail-width', `${w}px`);
        handle.setAttribute('aria-valuenow', String(Math.round(w)));
        ev.preventDefault();
      }
    });
  }

  buildMain() {
    this.title = h('h2', { class: 'item-title' });
    this.meta = h('span', { class: 'item-meta' });
    this.revertBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.revert() }, S.revert);
    this.inspectorToggle = h('button', { class: 'btn btn-quiet inspector-toggle', type: 'button', 'aria-expanded': 'true', 'aria-label': S.stepsPanel.toggleAria, onclick: () => this.toggleInspector() }, S.stepsPanel.toggle);
    this.railToggle = h('button', { class: 'btn btn-quiet rail-toggle', type: 'button', 'aria-controls': 'rail', 'aria-expanded': false, onclick: () => this.setRailOpen(!this.railOpen, false) }, S.items);
    this.head = h('div', { class: 'item-head' }, h('div', { class: 'item-title-row' }, this.railToggle, this.title), h('div', { class: 'item-actions' }, this.meta, this.revertBtn, this.inspectorToggle));
    this.info = h('div', { class: 'info-strip', hidden: true });
    this.editorHost = h('div', { class: 'editor-host' });
    this.editorHost.style.display = 'contents';
    this.editor = new Editor(this.editorHost, { language: 'm', label: S.editorAria, onChange: (t) => this.onEditorChange(t) });
    this.runBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.run() }, S.run, h('span', { class: 'item-meta' }, '⌘↵'));
    this.cancelBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => this.cancel() }, S.cancel);
    this.steps = h('div', { class: 'steps', role: 'group', 'aria-label': S.stepsLabel });
    this.diffBox = h('input', { type: 'checkbox', id: 'diff-box' });
    this.diffLabel = h('label', { class: 'check item-meta', for: 'diff-box', hidden: true }, this.diffBox, S.highlightDiffs);
    this.diffBox.addEventListener('change', () => this.applyDiffs());
    this.diffBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.showDifferences() }, S.viewDifferences);
    this.splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'aria-label': S.resizeSplit, 'aria-valuemin': '15', 'aria-valuemax': '85', 'aria-valuenow': '45' });
    this.runbar = h('div', { class: 'runbar' }, this.splitter, this.runBtn, this.cancelBtn, this.steps, h('span', { class: 'spacer' }), this.diffLabel, this.diffBtn);
    this.progress = h('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-label': S.running });
    this.crumbs = h('div', { class: 'crumbs', hidden: true });
    this.capNotice = h('div', { class: 'result-notice', hidden: true });
    this.resultBody = h('div', { class: 'result-body' });
    this.resultBody.style.display = 'flex';
    this.resultBody.style.flexDirection = 'column';
    this.resultBody.style.flex = '1';
    this.resultBody.style.minHeight = '0';
    this.sources = h('div', { class: 'crumbs', hidden: true });
    this.resultPanel = h('div', { class: 'result-panel' }, this.progress, this.crumbs, this.capNotice, this.resultBody, this.sources);
    this.segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': S.pane },
      h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => this.setPane('code') }, S.code),
      h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.setPane('result') }, S.result));
    this.main.append(this.head, this.segmented, this.info, this.editorHost, this.runbar, this.resultPanel);
    this.grid = new Grid(this.resultBody, { onDrill: (v, label) => this.drill(v, label), onError: (v, anchor) => this.showErrorCell(v, anchor) });
    this.grid.onNotice = (t) => this.status.set({ note: t });
    this.grid.el.hidden = true;
    this.messageEl = null;
    this.splitterSetup();
  }

  scheduleProblems(delay) {
    clearTimeout(this.problemsTimer);
    this.problemsTimer = setTimeout(() => this.computeProblems(), delay);
  }

  computeProblems() {
    const run = ++this.problemsRun;
    const s = this.session;
    const index = this.orchestrator.refresh();
    const text = s.currentSectionText();
    const modules = s.modules.map((m) => ({ name: m.name, kind: m.kind, text: s.textOf({ type: 'module', name: m.name }) }));
    this.libNames = this.libNames || supportedNames();
    const ctx = { sectionText: text, index, sources: sourcesOfSection(text), libNames: this.libNames, bound: new Set(s.bindings.keys()), lastRun: this.lastRunErrors, validate: (mod) => s.validateModule(mod.name, mod.text) };
    const jobs = [...index.members.map((m) => () => problemsForQuery(m.name, ctx)), ...modules.map((m) => () => problemsForModule(m, ctx))];
    const order = new Map([...index.members.map((m) => m.name), ...modules.map((m) => m.name)].map((n, i) => [n, i]));
    const rows = [];
    let at = 0;
    const slice = () => {
      if (run !== this.problemsRun) return;
      const t0 = performance.now();
      while (at < jobs.length && performance.now() - t0 < 8) rows.push(...jobs[at++]());
      if (at < jobs.length) {
        const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 100 }) : (fn) => setTimeout(fn, 0);
        idle(slice);
        return;
      }
      this.problemRows = sortProblems(rows, order);
      if (this.onProblems) this.onProblems(countProblems(this.problemRows), this.problemRows);
    };
    slice();
  }

  findItems() {
    const s = this.session;
    const cur = this.item;
    const queries = s.queries.map((q) => {
      const ed = s.queryEditable();
      return { type: 'query', name: q.name, text: s.textOf({ type: 'query', name: q.name }), readOnly: ed.editable ? null : errorMessage(ed.reason), current: !!cur && cur.type === 'query' && cur.name === q.name };
    });
    const modules = s.modules.map((m) => {
      const ed = s.moduleEditable(m.name);
      return { type: 'module', name: m.name, text: s.textOf({ type: 'module', name: m.name }), readOnly: ed.editable ? null : errorMessage(ed.reason), current: !!cur && cur.type === 'module' && cur.name === m.name };
    });
    if (this.item && this.item.type === 'query') {
      const live = queries.find((q) => q.current);
      if (live) live.text = this.editor.getText();
    }
    if (this.item && this.item.type === 'module') {
      const live = modules.find((m) => m.current);
      if (live) live.text = this.editor.getText();
    }
    return [...queries, ...modules];
  }

  openFind(replace) {
    const sel = this.editor.getSelectionText ? this.editor.getSelectionText() : '';
    openFind({ items: () => this.findItems() }, {
      onOpen: (item, m) => {
        this.select(item);
        this.editor.goto(m.line, m.col);
      },
      onApply: (changes, message) => {
        for (const c of changes) {
          this.select(c.item);
          this.editor.replaceDiff(c.text);
        }
        this.status.set({ note: message });
      }
    }, { replace, initial: sel && !/[\r\n]/.test(sel) ? sel : '' });
    return true;
  }

  openProblems() {
    if (!this.problemRows) return true;
    openProblems(() => this.problemRows, {
      onOpen: (r) => {
        this.select(r.item);
        this.editor.goto(r.line, r.col);
      }
    });
    return true;
  }

  onBatchEvent(e) {
    if (e.type === 'member') {
      if (e.status === 'error') this.lastRunErrors.set(e.name, { message: (e.event && e.event.error && e.event.error.message) || '' });
      else this.lastRunErrors.delete(e.name);
      this.scheduleProblems(0);
    }
    if (e.type === 'status' || e.type === 'member' || e.type === 'batch-start' || e.type === 'batch-end') this.paintStatuses();
    if (e.type === 'status') {
      const q = this.orchestrator.batch.names;
      this.status.set({ note: S.batch.running(q.indexOf(e.name) + 1, q.length, e.name) });
    }
  }

  paintStatuses() {
    if (this.depsPanel) this.refreshDeps();
    if (this.nav) this.nav.schedule();
  }

  async runBatch(mode) {
    if (this.runner.running || this.orchestrator.running) {
      this.status.set({ note: S.batch.busy });
      return true;
    }
    const item = this.item && this.item.type === 'query' ? this.item.name : null;
    this.setRunning(true);
    const r = await this.orchestrator.run(mode, { current: item });
    this.setRunning(false);
    this.paintStatuses();
    if (r.status === 'nothing') this.status.set({ note: S.batch.nothing });
    else this.status.set({ note: S.batch.summary(this.orchestrator.counts()) });
    if (item) this.showStored(item);
    return true;
  }

  showStored(name) {
    const p = previewFor(this.orchestrator, name, this.runner);
    if (!p) return false;
    this.renderResult({ status: 'ok', result: p.result, durationMs: p.durationMs, flags: p.flags, compare: p.compare }, false, p.resultId);
    return true;
  }

  toggleInspector() {
    const open = this.root.dataset.inspector !== 'open';
    this.root.dataset.inspector = open ? 'open' : 'closed';
    this.inspectorToggle.setAttribute('aria-expanded', String(open));
    if (open) this.refreshSteps();
    return true;
  }

  lineOfOffset(text, at) {
    return text.slice(0, at).split(/\r\n|\r|\n/).length;
  }

  caretStep(model) {
    if (!model || !model.steps || !model.steps.length) return null;
    const at = this.editor.caretOffset();
    const text = this.editor.getText();
    let found = null;
    for (const st of model.steps) if (text.lastIndexOf('\n', st.parts.coreStart - 1) + 1 <= at) found = st.name;
    return found || model.steps[0].name;
  }

  refreshSteps(focusName = null) {
    if (!this.item || this.item.type !== 'query') {
      this.stepsPanel.render(null);
      return;
    }
    const model = stepsOf(this.editor.getText(), 0, { members: new Set(this.session.queries.map((q) => q.name)) });
    this.stepsModel = model;
    this.stepsPanel.setResults(this.stepResults);
    this.stepsPanel.setRefreshedBy(this.item && this.item.type === 'query' ? this.refreshedByFor(this.item.name) : []);
    this.stepsPanel.render(model, this.caretStep(model));
    this.refreshDeps();
    if (focusName) this.stepsPanel.focusStep(focusName);
  }

  depsModel(name) {
    const index = this.orchestrator.refresh();
    if (!index.members.some((m) => m.name === name)) return null;
    const statuses = this.orchestrator.statuses();
    const qs = this.session.queries;
    const loaded = new Set(qs.filter((q) => q.load && q.load.kind === 'table').map((q) => q.name));
    return {
      upstream: [...upstreamOf(index, [name], { transitive: false })],
      downstream: [...downstreamOf(index, [name], { transitive: false })],
      statuses,
      impact: impactOf(downstreamOf(index, [name]), (n) => loaded.has(n))
    };
  }

  refreshDeps() {
    this.depsPanel.render(this.item && this.item.type === 'query' ? this.depsModel(this.item.name) : null);
  }

  openGraph(start = null) {
    const index = this.orchestrator.refresh();
    const cur = start || (this.item && this.item.type === 'query' ? this.item.name : null);
    openGraph({
      nodes: () => index.members.map((m) => m.name),
      edges: () => index.members.flatMap((m) => [...(index.refs.get(m.name) || [])].map((d) => [d, m.name])),
      statuses: () => this.orchestrator.statuses(),
      upstream: (n) => [...upstreamOf(index, [n], { transitive: false })],
      downstream: (n) => [...downstreamOf(index, [n], { transitive: false })]
    }, {
      open: (n) => this.select({ type: 'query', name: n }),
      run: (n) => {
        this.select({ type: 'query', name: n });
        this.run();
      },
      runDownstream: (n) => {
        this.select({ type: 'query', name: n });
        this.runBatch('run-downstream');
      }
    }, { start: cur });
    return true;
  }

  refreshedByFor(name) {
    if (!this.session.modules.length) return [];
    return refreshedBy(this.allPqLinks(), this.linkContext()).get(name) || [];
  }

  linkContext() {
    const qs = this.session.queries;
    return { queries: qs.map((q) => q.name), loaded: qs.filter((q) => q.load && q.load.kind === 'table').map((q) => q.name), queryOfTable: (t) => { const q = qs.find((x) => x.load && x.load.tableName === t); return q ? q.name : null; } };
  }

  allPqLinks() {
    const per = new Map();
    if (!this.linkCache) this.linkCache = new Map();
    for (const m of this.session.modules) {
      const text = this.item && this.item.type === 'module' && this.item.name === m.name ? this.editor.getText() : this.session.textOf({ type: 'module', name: m.name });
      const kind = this.moduleKindOf({ name: m.name });
      const hit = this.linkCache.get(m.name);
      let links;
      if (hit && hit.text === text && hit.kind === kind) links = hit.links;
      else {
        links = pqLinksOfModule(text, kind);
        this.linkCache.set(m.name, { text, kind, links });
      }
      if (links.size) per.set(m.name, links);
    }
    return per;
  }

  async runLinked(procName, names) {
    if (this.runner.running || this.orchestrator.running) {
      this.status.set({ note: S.batch.busy });
      return;
    }
    this.status.set({ note: S.pqLinks.note });
    this.setRunning(true);
    await this.orchestrator.run('run-selected', { selection: names, ordered: true });
    this.setRunning(false);
    this.paintStatuses();
    this.status.set({ note: `${S.pqLinks.forMacro(procName)}: ${S.batch.summary(this.orchestrator.counts())}` });
  }

  moduleKindOf(item) {
    const m = this.session.module(item.name);
    return m && (m.kind === 'standard' || m.kind === 'class') ? m.kind : 'document';
  }

  refreshOutline() {
    if (!this.item || this.item.type !== 'module') {
      this.outlinePanel.render(null, null, 0);
      return;
    }
    const text = this.editor.getText();
    const kind = this.moduleKindOf(this.item);
    const outline = outlineModule(text, { moduleKind: kind });
    const match = matchProcedures(this.session.originalText(this.item), text, kind);
    this.outlineModel = outline;
    const line = this.lineOfOffset(text, this.editor.caretOffset());
    const ctx = this.linkContext();
    const links = new Map();
    for (const [pname, ls] of pqLinksOfModule(text, kind)) {
      const resolved = resolveLinks(ls, ctx);
      links.set(pname, { plan: runPlanOf(resolved), hasAll: resolved.some((r) => r.kind === 'all'), reads: [...new Set(resolved.filter((r) => r.kind === 'read' && !r.dynamic && r.name).map((r) => r.name))] });
    }
    this.outlinePanel.render(outline, match, line, links);
    this.updateCrumb(outline, line);
  }

  updateCrumb(outline, line) {
    if (!this.item || this.item.type !== 'module') return;
    const m = this.session.module(this.item.name);
    const p = outline.procedures.find((x) => line >= x.startLine && line <= x.endLine);
    this.meta.textContent = p ? `${m ? m.kind : ''} \u203a ${p.name}` : m ? m.kind : '';
  }

  revertProc(key, name, putBack) {
    if (!this.item || this.item.type !== 'module') return;
    const res = revertProcedure(this.session.originalText(this.item), this.editor.getText(), key, this.moduleKindOf(this.item));
    if (!res.ok) {
      this.outlinePanel.announce(res.reason);
      return;
    }
    this.editor.replaceDiff(res.text);
    this.refreshOutline();
    this.outlinePanel.announce((putBack ? S.outline.done.putBack : S.outline.done.revert)(name));
  }

  syncCaretStep() {
    if (this.item && this.item.type === 'module') {
      const text = this.editor.getText();
      const line = this.lineOfOffset(text, this.editor.caretOffset());
      if (this.outlineModel) this.updateCrumb(this.outlineModel, line);
      this.refreshOutline();
      return;
    }
    if (!this.stepsModel || this.item === null || this.item.type !== 'query') return;
    const name = this.caretStep(this.stepsModel);
    if (name !== this.stepsPanel.caret) this.stepsPanel.render(this.stepsModel, name);
  }

  applySteps(res, done, focusName) {
    if (!res.ok) {
      this.stepsPanel.announce(res.reason);
      this.status.set({ note: res.reason });
      return false;
    }
    this.editor.replaceDiff(res.text);
    this.refreshSteps(focusName);
    this.stepsPanel.announce(done);
    return true;
  }

  stepActions() {
    const text = () => this.editor.getText();
    return {
      go: (st) => {
        this.editor.goto(this.lineOfOffset(text(), st.parts.coreStart), 1);
        this.showStepResult(st.name);
      },
      move: async (st, to) => {
        const model = stepsOf(text(), 0);
        const can = canMove(model, st.index, to);
        if (!can.ok) {
          this.stepsPanel.announce(can.reason);
          this.status.set({ note: can.reason });
          return;
        }
        if (can.mode === 'rewire') {
          const yes = await confirmDialog({ title: S.stepsPanel.rewireTitle, body: S.stepsPanel.rewireBody(st.name), confirmLabel: S.stepsPanel.rewireConfirm, cancelLabel: S.stepsPanel.cancel });
          if (!yes) {
            this.stepsPanel.focusStep(st.name);
            return;
          }
        }
        this.applySteps(moveStep(text(), st.index, to, { rewire: can.mode === 'rewire' }), S.stepsPanel.done.move(st.name), st.name);
      },
      rename: (st, name) => this.applySteps(renameStep(text(), st.index, name), S.stepsPanel.done.rename(name), name),
      del: (st) => {
        const next = this.stepsModel.steps[st.index + 1] || this.stepsModel.steps[st.index - 1];
        this.applySteps(deleteStep(text(), st.index), S.stepsPanel.done.delete(st.name), next ? next.name : null);
      },
      bypass: (st) => this.applySteps(st.bypassed ? unbypassStep(text(), st.index) : bypassStep(text(), st.index), (st.bypassed ? S.stepsPanel.done.restore : S.stepsPanel.done.bypass)(st.name), st.name),
      duplicate: (st) => this.applySteps(duplicateStep(text(), st.index), S.stepsPanel.done.duplicate(st.name), st.name),
      runTo: (st) => this.runSteps(st.name),
      runSteps: () => this.runSteps(null)
    };
  }

  showStepResult(name) {
    const r = this.stepResults.get(name);
    if (!r) return;
    if (r.status === 'ok' && r.result) this.renderResult({ status: 'ok', result: r.result, durationMs: r.durationMs, flags: [], compare: null }, true, r.resultId);
    else if (r.status === 'error') this.renderResult({ status: 'error', error: r.error }, true);
  }

  async runParams(item) {
    const s = this.session;
    const set = this.settings;
    const snapshot = await s.snapshot();
    return {
      sectionText: s.currentSectionText(),
      queryName: item.name,
      snapshot,
      bindings: [...s.bindings].map(([k, b]) => [k, { bytes: b.bytes, workbook: b.workbook }]),
      culture: set.culture,
      limits: { timeoutMs: set.timeoutS * 1000, maxRows: set.rowCap },
      useUpstream: set.useUpstream,
      previewRows: 200,
      now: new Date().toISOString(),
      localOffsetMin: -new Date().getTimezoneOffset()
    };
  }

  async runSteps(upTo) {
    const item = this.item;
    if (!item || item.type !== 'query' || this.runner.running) return;
    const model = stepsOf(this.editor.getText(), 0);
    if (model.shape !== 'let') return;
    const token = ++this.runToken;
    this.setPane('result');
    this.setRunning(true);
    const params = await this.runParams(item);
    const results = new Map();
    let final = null;
    const res = await this.runner.runSteps({ ...params, upTo }, {
      onNeedBinding: (kind, key) => this.askBinding(kind, key),
      onEvent: (m) => {
        if (m.type !== 'step-result') return;
        const entry = { status: m.status, rowCount: m.rowCount, durationMs: m.durationMs, result: m.result, resultId: m.resultId, error: m.error, cause: m.cause };
        if (m.name === null || m.name === undefined) final = entry;
        else results.set(m.name, entry);
      }
    });
    if (token !== this.runToken) return;
    this.setRunning(false);
    if (res.status !== 'ok') {
      this.renderResult(res, false);
      return;
    }
    this.stepResults = results;
    this.refreshSteps();
    const shown = upTo ? results.get(upTo) : final;
    if (shown && shown.status === 'ok' && shown.result) this.renderResult({ status: 'ok', result: shown.result, durationMs: shown.durationMs || res.durationMs || 0, flags: res.flags || [], compare: null }, !!upTo, shown.resultId);
    else if (shown && shown.status === 'error') this.renderResult({ status: 'error', error: shown.error }, true);
    else if (shown && shown.status === 'skipped') {
      const failed = [...results].find(([, v]) => v.status === 'error');
      if (failed) this.renderResult({ status: 'error', error: failed[1].error }, true);
    } else if (shown && shown.status === 'stopped') this.renderResult({ status: 'stopped', code: shown.code || 'm.timeout', detail: shown.detail }, true);
  }

  setRailOpen(open, returnFocus) {
    this.railOpen = open;
    this.root.dataset.rail = open ? 'open' : 'closed';
    this.railToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const stop = this.rail.querySelector('[role="treeitem"][tabindex="0"]');
      if (stop) stop.focus();
    } else if (returnFocus || this.rail.contains(document.activeElement)) {
      this.railToggle.focus();
    }
  }

  setPane(p) {
    this.main.dataset.pane = p;
    [...this.segmented.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (p === 'code'))));
  }

  splitterSetup() {
    let startY = 0;
    let startTop = 45;
    const move = (ev) => {
      const total = this.editorHost.getBoundingClientRect().height + this.resultPanel.getBoundingClientRect().height;
      const top = Math.max(15, Math.min(85, startTop + ((ev.clientY - startY) / total) * 100));
      this.main.style.setProperty('--top', `${top}fr`);
      this.main.style.setProperty('--bottom', `${100 - top}fr`);
      this.splitter.setAttribute('aria-valuenow', String(Math.round(top)));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    this.splitter.addEventListener('pointerdown', (ev) => {
      const total = this.editorHost.getBoundingClientRect().height + this.resultPanel.getBoundingClientRect().height;
      startTop = (this.editorHost.getBoundingClientRect().height / total) * 100;
      startY = ev.clientY;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    this.splitter.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      const cur = parseFloat(getComputedStyle(this.main).getPropertyValue('--top')) || 45;
      const top = Math.max(15, Math.min(85, cur + (ev.key === 'ArrowDown' ? 5 : -5)));
      this.main.style.setProperty('--top', `${top}fr`);
      this.main.style.setProperty('--bottom', `${100 - top}fr`);
      this.splitter.setAttribute('aria-valuenow', String(Math.round(top)));
    });
  }

  items() {
    return [...this.session.queries.map((q) => ({ type: 'query', name: q.name })), ...this.session.modules.map((m) => ({ type: 'module', name: m.name }))];
  }

  renderRail() {
    if (!this.nav) this.nav = new Navigator(this.rail, this.navSource(), this.navActions());
    this.nav.refresh();
    this.nav.setOpen(this.item);
    this.scheduleProblems(0);
  }

  navSource() {
    const s = this.session;
    const stepCache = new Map();
    return {
      queries: () => {
        const index = this.orchestrator.refresh();
        return s.queries.map((q) => ({
          name: q.name,
          load: q.load,
          loadTitle: loadLabel(q.load),
          folder: q.group ? q.group.name : '',
          isFunction: this.isFunction(q),
          edited: s.isEdited({ type: 'query', name: q.name }),
          refs: index && index.refs.has(q.name) ? index.refs.get(q.name).size : undefined,
          usedBy: index && index.usedBy.has(q.name) ? index.usedBy.get(q.name).size : undefined
        }));
      },
      modules: () => s.modules.map((m) => ({ name: m.name, edited: s.isEdited({ type: 'module', name: m.name }) })),
      statuses: () => this.orchestrator.statuses(),
      record: (name) => this.orchestrator.book.record(name),
      textOf: (item) => s.textOf(item),
      stepNames: (name) => {
        const text = s.textOf({ type: 'query', name });
        const hit = stepCache.get(name);
        if (hit && hit.text === text) return hit.names;
        let names = [];
        try {
          const model = stepsOf(text, 0, { members: new Set(s.queries.map((q) => q.name)) });
          names = model && model.steps ? model.steps.map((x) => x.name) : [];
        } catch {
          names = [];
        }
        stepCache.set(name, { text, names });
        return names;
      },
      linked: () => this.linkedQueries()
    };
  }

  navActions() {
    return {
      open: (item, needle) => this.openAt(item, needle),
      run: (names, downstream) => this.runSelection(names, downstream),
      revert: (items) => this.revertItems(items),
      graph: (name) => this.openGraph(name),
      notify: (note) => this.status.set({ note })
    };
  }

  linkedQueries() {
    if (!this.session.modules.length) return new Set();
    return new Set(refreshedBy(this.allPqLinks(), this.linkContext()).keys());
  }

  openAt(item, needle) {
    this.select(item);
    if (!needle) return;
    const text = this.editor.getText();
    const at = text.toLowerCase().indexOf(needle.toLowerCase());
    if (at < 0) return;
    const before = text.slice(0, at);
    const line = before.split(/\r\n|\r|\n/).length;
    const col = at - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    this.editor.goto(line, col);
  }

  async runSelection(names, downstream) {
    if (this.runner.running || this.orchestrator.running) {
      this.status.set({ note: S.batch.busy });
      return;
    }
    const index = this.orchestrator.refresh();
    const selection = downstream ? [...new Set([...names, ...downstreamOf(index, names)])] : names;
    const item = this.item && this.item.type === 'query' ? this.item.name : null;
    this.setRunning(true);
    const r = await this.orchestrator.run('run-selected', { selection });
    this.setRunning(false);
    this.paintStatuses();
    if (r.status === 'nothing') this.status.set({ note: S.batch.nothing });
    else this.status.set({ note: S.batch.summary(this.orchestrator.counts()) });
    if (item) this.showStored(item);
  }

  revertItems(items) {
    for (const it of items) this.session.revert(it);
    for (const it of items) this.markEdited(it);
    if (this.item && items.some((it) => it.type === this.item.type && it.name === this.item.name)) {
      this.editor.setText(this.session.textOf(this.item));
      this.revertBtn.hidden = true;
      if (this.item.type === 'query') this.checkLive(this.editor.getText());
    }
    for (const fn of this.onEditCallbacks) fn();
    this.nav.schedule();
  }

  railItems() {
    return [...this.rail.querySelectorAll('[role="treeitem"]')];
  }

  focusRail() {
    const stop = this.rail.querySelector('[role="treeitem"][tabindex="0"]');
    if (stop && stop.offsetParent !== null) stop.focus();
    else this.runBtn.focus();
  }

  syncRailSelection() {
    if (this.nav) this.nav.setOpen(this.item);
  }

  markEdited(item) {
    if (this.nav) this.nav.markEdited(item, this.session.isEdited(item));
  }

  isFunction(q) {
    if (q.isFn === undefined) {
      try {
        const ast = parseExpressionText(q.original);
        const bodyBinding = ast.t === 'Let' && ast.body.t === 'Identifier' ? ast.bindings.find((b) => b.name === ast.body.name) : null;
        q.isFn = ast.t === 'Function' || (!!bodyBinding && bodyBinding.expr.t === 'Function');
      } catch {
        q.isFn = false;
      }
    }
    return q.isFn;
  }

  step(dir) {
    const all = this.items();
    if (!all.length) return;
    const i = this.item ? all.findIndex((x) => x.type === this.item.type && x.name === this.item.name) : -1;
    this.select(all[(i + dir + all.length) % all.length]);
  }

  selectFirst() {
    const all = this.items();
    if (all.length) this.select(all[0]);
    else this.showNothing();
  }

  showNothing() {
    this.item = null;
    this.title.textContent = S.noSelection;
    this.meta.textContent = '';
    this.main.hidden = false;
  }

  select(item) {
    if (!this.orchestrator.running) this.cancel();
    this.item = item;
    this.drillStack = [];
    this.syncRailSelection();
    if (this.railOpen) this.setRailOpen(false, false);
    const s = this.session;
    const isQuery = item.type === 'query';
    this.main.classList.toggle('is-vba', !isQuery);
    this.root.dataset.kind = isQuery ? 'query' : 'vba';
    this.inspectorToggle.hidden = false;
    this.inspectorToggle.textContent = isQuery ? S.stepsPanel.toggle : S.outline.title;
    this.inspectorToggle.setAttribute('aria-label', isQuery ? S.stepsPanel.toggleAria : S.outline.toggleAria);
    this.stepResults = new Map();
    this.runbar.hidden = !isQuery;
    this.resultPanel.hidden = !isQuery;
    this.segmented.hidden = !isQuery;
    this.title.textContent = item.name;
    this.editor.setLanguage(isQuery ? 'm' : 'vba');
    this.editor.setLabel(S.editorAriaFor(isQuery ? S.editorAria : S.moduleAria, item.name));
    this.editor.setText(s.textOf(item));
    this.refreshSteps();
    this.refreshOutline();
    this.editor.setError(null);
    const ed = isQuery ? s.queryEditable() : s.moduleEditable(item.name);
    this.editor.setReadOnly(!ed.editable);
    this.info.hidden = false;
    this.info.classList.remove('problem');
    clear(this.info);
    if (!isQuery) {
      this.info.append(S.vbaInfo);
      if (!ed.editable) this.info.append(` ${errorMessage(ed.reason)}`);
      const m = s.module(item.name);
      this.meta.textContent = m ? m.kind : '';
    } else {
      this.info.hidden = ed.editable;
      if (!ed.editable) this.info.append(errorMessage(ed.reason));
      this.meta.textContent = loadLabel(s.query(item.name).load);
    }
    this.revertBtn.hidden = !s.isEdited(item);
    if (!isQuery && s.isEdited(item)) this.checkModule(s.textOf(item));
    this.clearResult();
    if (isQuery) this.checkLive(this.editor.getText());
    this.setPane('code');
    if (isQuery && this.showStored(item.name)) this.setPane('result');
  }

  onEditorChange(text) {
    if (!this.item) return;
    const s = this.session;
    s.setText(this.item, text);
    this.revertBtn.hidden = !s.isEdited(this.item);
    this.markEdited(this.item);
    this.stepResults = new Map();
    clearTimeout(this.stepsTimer);
    if (this.item) this.lastRunErrors.delete(this.item.name);
    this.stepsTimer = setTimeout(() => {
      this.refreshSteps();
      this.refreshOutline();
      this.paintStatuses();
    }, 150);
    this.scheduleProblems(300);
    clearTimeout(this.liveTimer);
    if (this.item.type === 'query') this.liveTimer = setTimeout(() => this.checkLive(text), 250);
    else this.liveTimer = setTimeout(() => this.checkModule(text), 300);
    for (const fn of this.onEditCallbacks) fn();
  }

  checkModule(text) {
    if (!this.item || this.item.type !== 'module') return;
    const problems = this.session.validateModule(this.item.name, text);
    clear(this.info);
    if (!problems.length) {
      this.editor.setError(null);
      this.info.classList.remove('problem');
      this.info.append(S.vbaInfo);
      return;
    }
    const p = problems[0];
    const message = errorMessage(p.code, p);
    this.editor.setError({ message, line: p.line, col: p.col, start: p.start, end: p.end });
    this.info.classList.add('problem');
    this.info.append(message);
  }

  checkLive(text) {
    try {
      parseExpressionText(text.replace(/\n/g, '\n'));
      this.editor.setError(null);
    } catch (e) {
      if (e instanceof MParseError) this.editor.setError({ message: e.message, line: e.line, col: e.col, start: e.start, end: e.end });
      else throw e;
    }
  }

  revert() {
    if (!this.item) return;
    this.session.revert(this.item);
    this.editor.setText(this.session.textOf(this.item));
    this.revertBtn.hidden = true;
    this.markEdited(this.item);
    if (this.item.type === 'query') this.checkLive(this.editor.getText());
    for (const fn of this.onEditCallbacks) fn();
  }

  revertAll() {
    const names = [...this.session.queryEdits.keys()].map((name) => ({ type: 'query', name })).concat([...this.session.moduleEdits.keys()].map((name) => ({ type: 'module', name })));
    for (const it of names) this.session.revert(it);
    for (const it of names) this.markEdited(it);
    if (this.item) {
      this.editor.setText(this.session.textOf(this.item));
      this.revertBtn.hidden = true;
      if (this.item.type === 'query') this.checkLive(this.editor.getText());
    }
    for (const fn of this.onEditCallbacks) fn();
  }

  clearResult() {
    this.grid.el.hidden = true;
    this.crumbs.hidden = true;
    this.diffLabel.hidden = true;
    this.diffBtn.hidden = true;
    clear(this.steps);
    this.setMessage(S.noResultYet, '');
    this.status.set({ run: null, compare: null });
    this.renderSources();
  }

  setMessage(text, cls, detail) {
    this.grid.el.hidden = true;
    if (this.messageEl) this.messageEl.remove();
    this.messageEl = h('div', { class: `message ${cls || ''}`, role: cls === 'error' ? 'alert' : null }, text, detail ? h('pre', null, detail) : null);
    this.resultBody.append(this.messageEl);
  }

  clearMessage() {
    this.capNotice.hidden = true;
    if (this.messageEl) {
      this.messageEl.remove();
      this.messageEl = null;
    }
  }

  setRunning(on) {
    const active = document.activeElement;
    this.progress.hidden = !on;
    this.runBtn.hidden = on;
    this.cancelBtn.hidden = !on;
    if (on && active === this.runBtn) this.cancelBtn.focus();
    else if (!on && active === this.cancelBtn) this.runBtn.focus();
  }

  async run(step) {
    const item = this.item;
    if (!item || item.type !== 'query' || this.runner.running) return;
    const s = this.session;
    const token = ++this.runToken;
    this.setPane('result');
    try {
      parseExpressionText(this.editor.getText());
    } catch (e) {
      if (e instanceof MParseError) {
        this.setMessage(S.lineCol(e.message, e.line, e.col), 'error');
        this.messageEl.append(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => this.editor.goto(e.line, e.col) }, S.goToError));
        this.status.set({ run: { error: 'm.parse' }, compare: null });
        return;
      }
      throw e;
    }
    this.setRunning(true);
    const q = s.query(item.name);
    let compareTo = null;
    if (!step && q.load.kind === 'table') {
      if (!this.cachedCompare.has(item.name)) {
        const table = s.wb.tables.find((t) => t.displayName === q.load.tableName && t.sheet === q.load.sheet);
        this.cachedCompare.set(item.name, table ? await readTable(s.wb, table) : null);
      }
      compareTo = this.cachedCompare.get(item.name);
    }
    const snapshot = await s.snapshot();
    const set = this.settings;
    const res = await this.runner.run({
      sectionText: s.currentSectionText(),
      queryName: item.name,
      snapshot,
      bindings: [...s.bindings].map(([k, b]) => [k, { bytes: b.bytes, workbook: b.workbook }]),
      culture: set.culture,
      limits: { timeoutMs: set.timeoutS * 1000, maxRows: set.rowCap },
      useUpstream: set.useUpstream,
      step: step || null,
      compareTo,
      previewRows: 200,
      now: new Date().toISOString(),
      localOffsetMin: -new Date().getTimezoneOffset()
    }, { onNeedBinding: (kind, key) => this.askBinding(kind, key) });
    if (token !== this.runToken) return;
    this.setRunning(false);
    this.renderResult(res, !!step);
  }

  async askBinding(kind, key) {
    const file = await bindingDialog(kind, key, this.item ? this.item.name : '');
    if (!file) return null;
    const b = await this.session.addBinding(key, file);
    this.renderSources();
    return { bytes: b.bytes, workbook: b.workbook };
  }

  renderSources() {
    clear(this.sources);
    const entries = [...this.session.bindings];
    this.sources.hidden = !entries.length;
    if (!entries.length) return;
    this.sources.append(h('span', null, S.sources));
    for (const [key, b] of entries) {
      this.sources.append(h('span', null, S.sourceMapping(key, b.name)), h('button', { type: 'button', onclick: () => {
        this.session.bindings.delete(key);
        this.renderSources();
      } }, S.clearSource));
    }
  }

  cancel() {
    if (this.runner.running) {
      this.runToken++;
      this.runner.cancel();
      this.setRunning(false);
      this.setMessage(S.cancelled, '');
      this.status.set({ run: { cancelled: true }, compare: null });
      return true;
    }
    return false;
  }

  renderResult(res, isStep, resultId = null) {
    this.clearMessage();
    clear(this.steps);
    this.diffLabel.hidden = true;
    this.diffBtn.hidden = true;
    this.crumbs.hidden = true;
    this.drillStack = [];
    this.lastResult = res;
    if (res.status === 'cancelled') return;
    if (res.status === 'ok' && res.steps && res.steps.length) {
      this.steps.append(h('span', null, S.stepsLabel));
      res.steps.forEach((name, i) => {
        const b = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => this.run(name) }, name);
        this.steps.append(b);
        if (i < res.steps.length - 1) this.steps.append(' · ');
      });
    }
    if (res.status === 'parse-error') {
      const e = res.error;
      this.setMessage(`${S.lineCol(e.message, e.line, e.col)}${e.member && e.member !== this.item.name ? S.inMember(e.member) : ''}`, 'error');
      if (!e.member || e.member === this.item.name) this.messageEl.append(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => this.editor.goto(e.line, e.col) }, S.goToError));
      this.status.set({ run: { error: 'm.parse' }, compare: null });
      return;
    }
    if (res.status === 'error') {
      const e = res.error;
      const detail = e.detail === null || e.detail === undefined ? '' : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
      this.setMessage(e.reason === 'Quoin.Unsupported' ? e.message : `${e.reason}: ${e.message}`, 'error', detail || null);
      if (e.reason === 'Quoin.Unsupported' && typeof e.detail === 'string') this.markCall(e.detail, e.message);
      this.status.set({ run: { error: e.reason }, compare: null });
      return;
    }
    if (res.status === 'stopped') {
      const key = res.code;
      const text = key === 'm.timeout' ? fmt(errorMessage(key), { s: this.settings.timeoutS }) : key === 'm.rows' ? fmt(errorMessage(key), { n: formatsFor(this.settings.culture).integer.format((res.detail && res.detail.rows) || this.settings.rowCap) }) : errorMessage(key);
      this.setMessage(text, 'warn');
      this.status.set({ run: { error: key }, compare: null });
      return;
    }
    if (res.status !== 'ok') {
      this.setMessage(S.readFailed, 'error', res.message || null);
      return;
    }
    const r = res.result;
    this.status.set({ culture: this.settings.culture });
    if (r.kind === 'function') {
      this.setMessage(S.functionResult, '');
      this.status.set({ run: { fn: true }, compare: null });
      return;
    }
    const secs = (res.durationMs / 1000).toFixed(2);
    if (r.kind === 'table') {
      const t = r.value;
      this.showTable(t, true, resultId);
      this.status.set({ run: { rows: t.rowCount, secs }, compare: isStep ? null : res.compare, flags: res.flags });
      this.pendingDiffs = res.compare && res.compare.diffs ? new Set(res.compare.diffs.map(([row, col]) => `${row}:${col}`)) : null;
      this.diffLabel.hidden = !(res.compare && res.compare.count > 0);
      this.diffBtn.hidden = this.diffLabel.hidden;
      this.diffBox.checked = false;
      return;
    }
    this.showValue(r.value, r.kind, secs, res.flags);
  }

  async showDifferences() {
    const compare = this.lastResult && this.lastResult.compare;
    const cached = this.item ? this.cachedCompare.get(this.item.name) : null;
    const table = this.lastResult && this.lastResult.result && this.lastResult.result.value;
    if (!compare || !compare.diffs || !cached || !table) return;
    const f = formatsFor(this.settings.culture);
    const shown = compare.diffs.slice(0, 200);
    const fetched = await Promise.all([...new Set(shown.map(([r]) => r))].map(async (r) => [r, table.rows[r] || (await this.runner.rows(r, 1))[0]]));
    const byRow = new Map(fetched);
    const excelText = (c) => {
      if (c === null || c === undefined) return S.nullText;
      if (c.t === 'n') return f.number.format(c.v);
      if (c.t === 'b') return c.v ? S.booleanTrue : S.booleanFalse;
      return String(c.v);
    };
    const rows = shown.map(([r, c]) => {
      const row = byRow.get(r);
      const v = row ? row[c] : undefined;
      const quoin = cellDisplay(v && typeof v === 'object' && v.k === 'error' ? null : v, f.number).text;
      const excel = excelText(cached.rows[r][c]);
      return { row: r + 1, column: table.columns[c].name, excel, quoin, typeOnly: excel === quoin };
    });
    differencesDialog({ rows, total: compare.count, caption: S.differencesTitle });
  }

  markCall(name, message) {
    const text = this.editor.getText();
    const at = text.indexOf(name);
    if (at < 0) return;
    const before = text.slice(0, at);
    const line = before.split('\n').length;
    const col = at - before.lastIndexOf('\n');
    this.editor.setError({ message, line, col, start: at, end: at + name.length });
  }

  applyCulture() {
    this.grid.setCulture(this.settings.culture);
    this.grid.rerender();
  }

  showTable(t, remote, resultId = null) {
    this.clearMessage();
    this.grid.el.hidden = false;
    this.grid.setCulture(this.settings.culture);
    this.grid.setData({ columns: t.columns, rowCount: t.rowCount, rows: t.rows, loader: remote && t.rowCount > t.rows.length ? (start, count) => this.runner.rows(start, count, { resultId }) : null });
    this.capNotice.hidden = !t.truncated;
    this.capNotice.textContent = t.truncated ? S.rowCapShown(formatsFor(this.settings.culture).integer.format(t.rows.length)) : '';
    this.grid.el.setAttribute('aria-label', S.resultAria(this.item ? this.item.name : ''));
  }

  showValue(v, kind, secs, flags) {
    if (v && typeof v === 'object' && v.k === 'list') {
      const rows = v.items.map((x) => [x]);
      this.showTable({ columns: [{ name: S.itemColumn, type: 'any' }], rowCount: v.count, rows, truncated: v.truncated }, false);
      this.status.set({ run: { rows: v.count, secs }, compare: null, flags });
      return;
    }
    if (v && typeof v === 'object' && v.k === 'record') {
      const rows = v.names.map((n, i) => [n, v.values[i]]);
      this.showTable({ columns: [{ name: S.nameColumn, type: 'text' }, { name: S.valueColumn, type: 'any' }], rowCount: rows.length, rows, truncated: false }, false);
      this.status.set({ run: { rows: rows.length, secs }, compare: null, flags });
      return;
    }
    const text = v === null ? S.nullText : typeof v === 'object' ? v.text || v.special || kind : String(v);
    this.setMessage(text, 'value');
    this.status.set({ run: { value: true, secs }, compare: null, flags });
  }

  drill(v, label) {
    const prev = { label: this.drillStack.length ? this.drillStack[this.drillStack.length - 1].label : S.drillRoot };
    void prev;
    this.drillStack.push({ label, value: v });
    this.showNested(v);
    this.renderCrumbs();
  }

  showNested(v) {
    if (v.k === 'table') this.showTable(v, false);
    else if (v.k === 'list') this.showTable({ columns: [{ name: S.itemColumn, type: 'any' }], rowCount: v.count, rows: v.items.map((x) => [x]), truncated: v.truncated }, false);
    else this.showTable({ columns: [{ name: S.nameColumn, type: 'text' }, { name: S.valueColumn, type: 'any' }], rowCount: v.names.length, rows: v.names.map((n, i) => [n, v.values[i]]), truncated: false }, false);
  }

  renderCrumbs() {
    clear(this.crumbs);
    this.crumbs.hidden = !this.drillStack.length;
    if (!this.drillStack.length) return;
    this.crumbs.append(h('button', { type: 'button', onclick: () => this.drillTo(-1) }, S.drillRoot));
    this.drillStack.forEach((d, i) => {
      this.crumbs.append(' › ');
      if (i === this.drillStack.length - 1) this.crumbs.append(h('span', { 'aria-current': 'location' }, d.label));
      else this.crumbs.append(h('button', { type: 'button', onclick: () => this.drillTo(i) }, d.label));
    });
  }

  drillTo(i) {
    this.drillStack = this.drillStack.slice(0, i + 1);
    if (i < 0) {
      if (this.lastResult && this.lastResult.status === 'ok') this.renderResultTableOnly();
    } else this.showNested(this.drillStack[i].value);
    this.renderCrumbs();
  }

  renderResultTableOnly() {
    const r = this.lastResult.result;
    if (r.kind === 'table') {
      this.showTable(r.value, true);
      if (this.pendingDiffs && this.diffBox.checked) this.grid.setDiffs(this.pendingDiffs);
    } else this.showValue(r.value, r.kind, (this.lastResult.durationMs / 1000).toFixed(2), this.lastResult.flags);
  }

  applyDiffs() {
    this.grid.setDiffs(this.diffBox.checked ? this.pendingDiffs : null);
  }

  showErrorCell(v, anchor) {
    const content = h('div', null, h('p', null, h('strong', null, S.reasonLabel), v.reason), h('p', null, h('strong', null, S.messageLabel), v.message), v.detail ? h('p', null, h('strong', null, S.detailLabel), String(v.detail)) : null);
    popover(anchor, content, null, S.errorText);
  }

  get hasTableResult() {
    return !!(this.lastResult && this.lastResult.status === 'ok' && this.lastResult.result.kind === 'table');
  }

  get hasValueResult() {
    return !!(this.lastResult && this.lastResult.status === 'ok' && this.lastResult.result.kind !== 'function');
  }
}

export { svgImg };
