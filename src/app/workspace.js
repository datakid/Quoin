import { h, clear, svgImg } from '../ui/dom.js';
import { S, fmt, errorMessage } from '../ui/strings.js';
import { Editor } from '../ui/editor.js';
import { Grid, cellDisplay } from '../ui/grid.js';
import { popover, menu, bindingDialog, differencesDialog, confirmDialog } from '../ui/dialogs.js';
import { StepsPanel } from '../ui/wb/steps-panel.js';
import { OutlinePanel } from '../ui/wb/outline-panel.js';
import { DepsPanel } from '../ui/wb/deps-panel.js';
import { mountGraph } from '../ui/wb/graph-view.js';
import { upstreamOf, downstreamOf } from '../core/wb/deps.js';
import { impactOf } from '../core/wb/graph-layout.js';
import { outlineModule } from '../core/vba/outline.js';
import { pqLinksOfModule, resolveLinks, runPlanOf, refreshedBy } from '../core/vba/pq-links.js';
import { matchProcedures, revertProcedure } from '../core/vba/proc-diff.js';
import { mountProblems } from '../ui/wb/problems-view.js';
import { Dock } from '../ui/wb/dock.js';
import { renderPinned, renderQueue, renderCompare, renderChanges, pinLabel } from '../ui/wb/dock-views.js';
import { summariesFor } from './change-summary.js';
import { openFind } from '../ui/wb/find-dialog.js';
import { filterDialog, stepDialog, profileSheet } from '../ui/wb/column-tools.js';
import { insertViewSteps } from '../core/wb/view-steps.js';
import { OpHistory } from '../core/wb/op-history.js';
import { PRESETS, dockSplit } from '../core/wb/layout-presets.js';
import { planRun } from '../core/wb/run-plan.js';
import { sourcesDialog, unboundDialog } from '../ui/wb/sources-dialog.js';
import { DEFAULT_LIMITS } from '../core/limits.js';
import { problemsForQuery, problemsForModule, sortProblems, countProblems } from '../core/wb/problems.js';
import { sourcesOfSection, unboundFor } from '../core/wb/sources.js';
import { M_NAMES, supportedNames } from '../ui/wb/m-names.js';
import { stepsOf } from '../core/wb/steps.js';
import { Navigator } from '../ui/wb/navigator.js';
import { TabStrip } from '../ui/wb/tabs.js';
import { paneRail, bindResizer, Regions } from '../ui/wb/panes.js';
import { TabModel, keyOf } from '../core/wb/tabs-model.js';
import { canMove, moveStep, renameStep, deleteStep, bypassStep, unbypassStep, duplicateStep, insertStepAfter, quoteIdent } from '../core/wb/let-edit.js';
import { parseExpressionText, MParseError } from '../core/m/parser.js';
import { readTable } from '../core/cells.js';
import { formatsFor } from '../ui/formats.js';
import { sanitizeFileName } from '../core/export/files.js';
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
    this.tabs = new TabModel();
    this.groups = [];
    this.dragKey = null;
    this.pins = [];
    this.currentResult = null;
    this.lastStep = null;
    this.compareState = { a: null, b: null, side: false };
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
    this.inspector.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.root.dataset.sheet === 'steps' && !ev.defaultPrevented) {
        ev.stopPropagation();
        this.toggleInspector();
      }
    });
    this.drillStack = [];
    this.lastRun = null;
    this.cachedCompare = new Map();
    this.runToken = 0;
    this.onEditCallbacks = [];
    this.histories = new Map();
    this.onEdit(() => this.syncChangesTab());
    this.resizer();
  }

  onEdit(fn) {
    this.onEditCallbacks.push(fn);
  }

  resizer() {
    const rail = h('div', { class: 'rail-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': S.resizeRail, 'aria-valuemin': '220', 'aria-valuemax': '420', 'aria-valuenow': '272', tabindex: '0' });
    this.rail.append(rail);
    bindResizer(rail, {
      get: () => this.rail.getBoundingClientRect().width,
      set: (w) => this.root.style.setProperty('--rail-width', `${w}px`),
      min: 220,
      max: 420
    });
    const insp = h('div', { class: 'inspector-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': S.panes.resizeInspector, 'aria-valuemin': '260', 'aria-valuemax': '480', 'aria-valuenow': '312', tabindex: '0' });
    this.inspector.append(insp);
    bindResizer(insp, {
      get: () => this.inspector.getBoundingClientRect().width,
      set: (w) => this.root.style.setProperty('--inspector-width', `${w}px`),
      min: 260,
      max: 480,
      grow: -1
    });
    this.navRail = paneRail('\u203a', S.panes.expandNavigator, () => this.toggleNavigator());
    this.rail.append(this.navRail.el);
    this.inspRail = paneRail('\u2039', S.panes.expandInspector, () => this.toggleInspector());
    this.inspector.append(this.inspRail.el);
    this.dockRail = paneRail('\u2303', S.panes.expandDock, () => this.toggleDock());
    this.main.append(this.dockRail.el);
  }

  buildMain() {
    this.title = h('h2', { class: 'item-title' });
    this.meta = h('span', { class: 'item-meta' });
    this.revertBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.revert() }, S.revert);
    this.inspectorToggle = h('button', { class: 'btn btn-quiet inspector-toggle', type: 'button', 'aria-expanded': 'true', 'aria-label': S.stepsPanel.toggleAria, onclick: () => this.toggleInspector() }, S.stepsPanel.toggle);
    this.railToggle = h('button', { class: 'rail-toggle', type: 'button', 'aria-controls': 'rail', 'aria-expanded': 'false', 'aria-pressed': 'false', onclick: () => this.setRailOpen(!this.railOpen, false) }, S.items);
    this.railToggleWide = h('button', { class: 'btn btn-quiet rail-toggle-wide', type: 'button', 'aria-controls': 'rail', 'aria-expanded': 'false', onclick: () => this.setRailOpen(!this.railOpen, false) }, S.items);
    this.head = h('div', { class: 'item-head' }, h('div', { class: 'item-title-row' }, this.railToggleWide, this.title), h('div', { class: 'item-actions' }, this.meta, this.revertBtn, this.inspectorToggle));
    this.info = h('div', { class: 'info-strip', hidden: true });
    this.groupsEl = h('div', { class: 'editor-groups' });
    this.editorHost = this.groupsEl;
    this.dropSplit = h('div', { class: 'drop-split', hidden: true }, S.tabs.dropSplit);
    for (const t of ['dragenter', 'dragover']) {
      this.dropSplit.addEventListener(t, (ev) => {
        if (this.dragKey) ev.preventDefault();
      });
    }
    this.dropSplit.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.dropOn(1);
    });
    this.groupsEl.append(this.dropSplit);
    this.addGroup();
    this.editor = this.groups[0].editor;
    this.runBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.run() }, S.run, h('span', { class: 'item-meta' }, '⌘↵'));
    this.moreRunBtn = h('button', { class: 'btn btn-quiet more-run', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': S.panes.moreRun, onclick: () => this.openRunMenu() }, '\u25be');
    this.dockToggle = h('button', { class: 'btn btn-quiet dock-toggle', type: 'button', 'aria-expanded': 'true', 'aria-label': S.panes.collapseDock, onclick: () => this.toggleDock() }, '\u2304');
    this.cancelBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => this.cancel() }, S.cancel);
    this.steps = h('div', { class: 'steps', role: 'group', 'aria-label': S.stepsLabel });
    this.diffBox = h('input', { type: 'checkbox', id: 'diff-box' });
    this.diffLabel = h('label', { class: 'check item-meta', for: 'diff-box', hidden: true }, this.diffBox, S.highlightDiffs);
    this.diffBox.addEventListener('change', () => this.applyDiffs());
    this.diffBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.showDifferences() }, S.viewDifferences);
    this.splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'aria-label': S.resizeSplit, 'aria-valuemin': '15', 'aria-valuemax': '85', 'aria-valuenow': '45' });
    this.runbar = h('div', { class: 'runbar' }, this.splitter, this.runBtn, this.moreRunBtn, this.cancelBtn, this.steps, h('span', { class: 'spacer' }), this.diffLabel, this.diffBtn, this.dockToggle);
    this.progress = h('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-label': S.running });
    this.crumbs = h('div', { class: 'crumbs', hidden: true });
    this.capNotice = h('div', { class: 'result-notice', hidden: true });
    this.resultBody = h('div', { class: 'result-body' });
    this.resultBody.style.display = 'flex';
    this.resultBody.style.flexDirection = 'column';
    this.resultBody.style.flex = '1';
    this.resultBody.style.minHeight = '0';
    this.sources = h('div', { class: 'crumbs', hidden: true });
    this.dock = new Dock({ onShow: (id) => this.onDockShow(id) });
    this.pinBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.pinCurrent() }, S.dock.pin);
    this.view = null;
    this.viewChip = h('span', { class: 'chip view', hidden: true });
    this.viewClear = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.clearView() }, S.colTools.viewClear);
    this.viewSteps = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, onclick: () => this.addViewAsSteps() }, S.colTools.viewToSteps);
    this.viewNote = h('span', { class: 'sr-only', 'aria-live': 'polite' });
    this.headLine = h('span', { class: 'result-line' });
    this.verdict = h('span', { class: 'chip', hidden: true });
    this.exportBtn = h('button', { class: 'btn btn-quiet', type: 'button', hidden: true, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => this.openResultExport() }, S.resultHead.export);
    this.resultHead = h('span', { class: 'result-head', hidden: true, role: 'group', 'aria-label': S.resultHead.label }, this.headLine, this.verdict);
    this.onSave = null;
    this.dock.panel('result').append(h('div', { class: 'dock-actions result-actions' }, this.resultHead, this.viewChip, this.viewClear, this.viewSteps, this.pinBtn, this.exportBtn, this.viewNote), this.progress, this.crumbs, this.capNotice, this.resultBody, this.sources);
    this.resultPanel = h('div', { class: 'result-panel' }, this.dock.tabs, this.dock.body);
    this.codeBtn = h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => this.setRegion('code') }, S.code);
    this.stepsBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.setRegion('steps') }, S.stepsPanel.toggle);
    this.resultBtn = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.setRegion('result') }, S.result);
    this.barProblems = h('button', { class: 'bar-problems', type: 'button', hidden: true, onclick: () => this.openProblems() }, S.problems.count(0));
    this.segmented = h('div', { class: 'segmented bottombar', role: 'group', 'aria-label': S.pane }, this.railToggle, this.codeBtn, this.stepsBtn, this.resultBtn, this.barProblems);
    this.main.append(this.head, this.info, this.groupsEl, this.runbar, this.resultPanel);
    this.root.append(this.segmented);
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
      const counts = countProblems(this.problemRows);
      this.paintBarProblems(counts);
      if (this.onProblems) this.onProblems(counts, this.problemRows);
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
    this.showDock('problems');
    return true;
  }

  showDock(id) {
    if (this.main.dataset.dock === 'collapsed') this.toggleDock();
    this.dock.show(id);
    if (window.matchMedia('(max-width: 639px)').matches) this.setPane('result');
    this.syncDock();
  }

  syncDock() {
    const isQuery = !!this.item && this.item.type === 'query';
    const open = isQuery || this.dock.current !== 'result';
    this.resultPanel.hidden = !open;
    this.main.dataset.dockOpen = String(!isQuery && open);
    if (!isQuery) this.pinBtn.hidden = true;
  }

  onDockShow(id) {
    this.syncDock();
    this.paintDockTab(id);
  }

  paintDockTab(id) {
    const panel = this.dock.panel(id);
    if (id === 'problems') {
      this.problemsView = mountProblems(panel, () => this.problemRows || [], {
        onOpen: (r) => {
          this.select(r.item);
          this.editor.goto(r.line, r.col);
        }
      });
    } else if (id === 'pinned') this.paintPinned();
    else if (id === 'queue') this.paintQueue();
    else if (id === 'compare') this.paintCompare();
    else if (id === 'graph') this.mountGraphPanel();
    else if (id === 'changes') this.paintChanges();
  }

  paintChanges() {
    const changes = this.session.changes();
    const names = new Set([...changes.queries.keys(), ...changes.modules.keys()]);
    const moduleKind = (n) => {
      const m = this.session.module(n);
      return m && (m.kind === 'standard' || m.kind === 'class') ? m.kind : 'document';
    };
    const problems = (this.problemRows || []).filter((p) => names.has(p.item.name) && (p.severity === 'error' || p.severity === 'warning'));
    renderChanges(this.dock.panel('changes'), changes, { summaries: summariesFor(changes, moduleKind), problems, onRevertAll: () => this.revertAllConfirmed() });
  }

  syncChangesTab() {
    this.dock.badge('changes', this.session.editCount || null);
    if (this.dock.current !== 'changes') return;
    clearTimeout(this.changesTimer);
    this.changesTimer = setTimeout(() => this.paintChanges(), 250);
  }

  async revertAllConfirmed() {
    const n = this.session.editCount;
    const ok = await confirmDialog({ title: S.revertAllTitle, body: S.revertAllBody(n), confirmLabel: S.revertAll });
    if (!ok) return;
    this.revertAll();
    this.status.set({ note: S.revertedAll });
  }

  pinStale(p) {
    const q = this.session.query(p.query);
    return !q || this.session.textOf({ type: 'query', name: p.query }) !== p.text;
  }

  async pinCurrent() {
    await this.pinEntry(this.currentResult);
  }

  async pinStep(st) {
    const r = this.stepResults.get(st.name);
    if (!r || r.status !== 'ok' || !r.resultId || !r.result || r.result.kind !== 'table') {
      this.status.set({ note: S.dock.pinNone });
      return;
    }
    const t = r.result.value;
    await this.pinEntry({ id: r.resultId, query: this.item.name, step: st.name, columns: t.columns, rowCount: t.rowCount, at: Date.now() });
  }

  async pinEntry(c) {
    if (!c || !c.id) {
      this.status.set({ note: S.dock.pinNone });
      return;
    }
    if (this.pins.some((p) => p.id === c.id)) {
      this.dock.show('pinned');
      return;
    }
    const ok = await this.runner.pin(c.id);
    if (!ok) {
      this.status.set({ note: S.dock.pinNone });
      return;
    }
    this.pins.push({ ...c, text: this.session.textOf({ type: 'query', name: c.query }) });
    this.dock.badge('pinned', this.pins.length);
    this.status.set({ note: S.dock.pinned(pinLabel(c)) });
    if (this.dock.current === 'pinned') this.paintPinned();
  }

  paintPinned() {
    renderPinned(this.dock.panel('pinned'), this.pins, {
      isStale: (p) => this.pinStale(p),
      onShow: (p) => this.showPin(p),
      onUnpin: (p) => this.unpin(p),
      onCompare: (p) => {
        this.compareState.a = p.id;
        this.dock.show('compare');
      }
    });
  }

  showPin(p) {
    if (this.session.query(p.query)) this.select({ type: 'query', name: p.query });
    this.dock.show('result');
    this.setPane('result');
    this.showTable({ columns: p.columns, rowCount: p.rowCount, rows: [] }, true, p.id);
    this.status.set({ note: pinLabel(p) });
  }

  async unpin(p) {
    await this.runner.pin(p.id, false);
    this.pins = this.pins.filter((x) => x.id !== p.id);
    this.dock.badge('pinned', this.pins.length || null);
    this.paintPinned();
  }

  compareOptions() {
    const opts = this.pins.map((p) => ({ id: p.id, label: pinLabel(p), columns: p.columns, rowCount: p.rowCount }));
    const c = this.currentResult;
    if (c && c.id && !this.pins.some((p) => p.id === c.id)) opts.push({ id: c.id, label: `${S.dock.current}: ${pinLabel(c)}`, columns: c.columns, rowCount: c.rowCount });
    return opts;
  }

  paintCompare() {
    renderCompare(this.dock.panel('compare'), this.compareOptions(), this.compareState, (o) => this.runner.rowsOf(o.id, 0, 1000), () => this.paintCompare(), (o, host) => this.sideGrid(o, host));
  }

  sideGrid(o, host) {
    const g = new Grid(host, { onDrill: () => {}, onError: () => {} });
    g.setCulture(this.settings.culture);
    g.setData({ columns: o.columns, rowCount: o.rowCount, rows: null, loader: (start, count) => this.runner.rows(start, count, { resultId: o.id }) });
    g.el.setAttribute('aria-label', o.label);
    return g;
  }

  paintQueue() {
    const rows = this.orchestrator.queue();
    const ms = rows.reduce((n, r) => n + (r.durationMs || 0), 0);
    renderQueue(this.dock.panel('queue'), rows, S.dock.queueSummary(rows.length, Math.round(ms)));
    this.dock.badge('queue', rows.length || null);
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
    this.syncInactive();
    this.paintTabs();
    if (this.dock.current === 'queue') this.paintQueue();
  }

  async runBatch(mode) {
    if (this.runner.running || this.orchestrator.running) {
      this.status.set({ note: S.batch.busy });
      return true;
    }
    const item = this.item && this.item.type === 'query' ? this.item.name : null;
    if (!(await this.preflightSources(mode, { current: item }))) return true;
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
    if (window.matchMedia('(max-width: 1099px)').matches) {
      if (this.root.dataset.sheet === 'steps') {
        this.setPane(this.main.dataset.pane || 'code');
        this.inspectorToggle.setAttribute('aria-expanded', 'false');
        this.inspectorToggle.focus();
      } else {
        this.setRegion('steps');
        this.inspectorToggle.setAttribute('aria-expanded', 'true');
      }
      return true;
    }
    const open = this.root.dataset.inspector !== 'open';
    const inside = this.inspector.contains(document.activeElement);
    this.root.dataset.inspector = open ? 'open' : 'closed';
    this.inspectorToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      this.refreshSteps();
      if (document.activeElement === this.inspRail.btn) this.inspectorToggle.focus();
    } else if (inside) this.inspRail.btn.focus();
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
    if (this.undoKey !== this.historyKey()) this.stepsPanel.hideUndo();
    this.stepsPanel.setHistorySize(this.item && this.item.type === 'query' ? this.history().size : 0);
    const model = stepsOf(this.editor.getText(), 0, { members: new Set(this.session.queries.map((q) => q.name)) });
    this.stepsModel = model;
    this.stepsPanel.setCountOptions({ countRows: this.settings.countRows, limit: DEFAULT_LIMITS.stepCountRows });
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
    this.graphStart = start || (this.item && this.item.type === 'query' ? this.item.name : null);
    if (this.main.dataset.dock === 'collapsed') this.toggleDock();
    if (window.matchMedia('(max-width: 639px)').matches) this.setPane('result');
    if (this.dock.current === 'graph') this.mountGraphPanel();
    else this.dock.show('graph');
    this.syncDock();
    if (this.graphView) this.graphView.focus();
    return true;
  }

  mountGraphPanel() {
    const index = this.orchestrator.refresh();
    const cur = this.graphStart || (this.item && this.item.type === 'query' ? this.item.name : null);
    this.graphStart = null;
    this.graphView = mountGraph(this.dock.panel('graph'), {
      nodes: () => index.members.map((m) => m.name),
      edges: () => index.members.flatMap((m) => [...(index.refs.get(m.name) || [])].map((d) => [d, m.name])),
      statuses: () => this.orchestrator.statuses(),
      upstream: (n) => [...upstreamOf(index, [n], { transitive: false })],
      downstream: (n) => [...downstreamOf(index, [n], { transitive: false })]
    }, {
      open: (n) => this.select({ type: 'query', name: n }),
      run: (n) => {
        this.select({ type: 'query', name: n });
        this.dock.show('result');
        this.run();
      },
      runDownstream: (n) => {
        this.select({ type: 'query', name: n });
        this.dock.show('queue');
        this.runBatch('run-downstream');
      }
    }, { start: cur });
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

  applySteps(res, done, focusName, rerun = true) {
    if (!res.ok) {
      this.stepsPanel.announce(res.reason);
      this.status.set({ note: res.reason });
      return false;
    }
    const before = this.editor.getText();
    this.editor.replaceDiff(res.text);
    this.refreshSteps(focusName);
    this.stepsPanel.announce(done);
    const op = this.history().record(done, before, this.editor.getText());
    if (op) {
      this.undoKey = this.historyKey();
      this.stepsPanel.showUndo(done);
      this.stepsPanel.setHistorySize(this.history().size);
    }
    if (rerun) this.autoRunSteps();
    return true;
  }

  autoRunSteps() {
    if (!this.settings.autoRunSteps || this.runner.running || !this.stepsModel || this.stepsModel.shape !== 'let') return;
    this.runSteps(null);
  }

  historyKey() {
    return this.item ? `${this.item.type}:${this.item.name}` : '';
  }

  history() {
    const key = this.historyKey();
    if (!this.histories.has(key)) this.histories.set(key, new OpHistory());
    return this.histories.get(key);
  }

  undoOperation() {
    if (!this.item || this.item.type !== 'query') return false;
    const hist = this.history();
    const op = hist.undoable(this.editor.getText());
    if (!op) {
      this.stepsPanel.announce(S.stepsPanel.undoStale);
      this.stepsPanel.hideUndo();
      return false;
    }
    this.editor.replaceDiff(op.before);
    hist.record(S.stepsPanel.undone(op.label), op.after, this.editor.getText());
    this.refreshSteps();
    this.stepsPanel.hideUndo();
    this.stepsPanel.setHistorySize(hist.size);
    this.stepsPanel.announce(S.stepsPanel.undone(op.label));
    this.autoRunSteps();
    return true;
  }

  restoreVersion(v) {
    const now = this.editor.getText();
    if (v.text === now) return;
    const label = v.label === null ? S.stepsPanel.restoredOriginal : S.stepsPanel.restored(v.label);
    this.editor.replaceDiff(v.text);
    this.history().record(label, now, this.editor.getText());
    this.refreshSteps();
    this.stepsPanel.hideUndo();
    this.stepsPanel.setHistorySize(this.history().size);
    this.stepsPanel.announce(label);
    this.autoRunSteps();
  }

  stepActions() {
    const text = () => this.editor.getText();
    return {
      undo: () => this.undoOperation(),
      versions: () => this.history().versions(),
      restore: (v) => this.restoreVersion(v),
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
      pin: (st) => this.pinStep(st),
      runSteps: () => this.runSteps(null),
      can: (st, to) => {
        const c = canMove(stepsOf(text(), 0), st.index, to);
        return { ok: c.ok, reason: c.reason };
      },
      ref: (st) => quoteIdent(st.name),
      insert: (st, name, expr) => {
        const t = text();
        const wired = insertStepAfter(t, st.index, name, expr, { rewire: true });
        this.applySteps(wired.ok ? wired : insertStepAfter(t, st.index, name, expr), S.stepsPanel.done.insert(name), name);
      },
      cursor: (dir, from) => this.moveStepCursor(dir, from)
    };
  }

  hasSteps() {
    const m = this.stepsModel;
    return !!this.item && this.item.type === 'query' && !!m && !!m.steps && m.steps.length > 0;
  }

  stepCursorActive() {
    if (!this.hasSteps()) return false;
    const a = document.activeElement;
    return !!a && (this.groupsEl.contains(a) || this.stepsHost.contains(a));
  }

  moveStepCursor(dir, from = null) {
    const model = this.stepsModel;
    if (!this.hasSteps()) return false;
    const cur = from || this.caretStep(model);
    const at = cur ? model.steps.findIndex((x) => x.name === cur) : -1;
    const idx = Math.max(0, Math.min(model.steps.length - 1, at + dir));
    const next = model.steps[idx];
    this.stepActions().go(next);
    this.syncCaretStep();
    if (from) this.stepsPanel.focusStep(next.name);
    this.stepsPanel.announce(S.stepsPanel.cursorAt(next.name, idx + 1, model.steps.length));
    if (!this.stepResults.get(next.name)) this.status.set({ note: S.stepsPanel.notEvaluated });
    return true;
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
    if (open) this.root.dataset.sheet = '';
    for (const b of [this.railToggle, this.railToggleWide]) b.setAttribute('aria-expanded', String(open));
    this.railToggle.setAttribute('aria-pressed', String(open));
    if (open) {
      const stop = this.rail.querySelector('[role="treeitem"][tabindex="0"]');
      if (stop) stop.focus();
    } else if (returnFocus || this.rail.contains(document.activeElement)) {
      (this.railToggle.getClientRects().length ? this.railToggle : this.railToggleWide).focus();
    }
    this.paintBar();
  }

  setPane(p) {
    this.main.dataset.pane = p;
    this.root.dataset.sheet = '';
    this.paintBar();
  }

  setRegion(r) {
    if (r === 'items') {
      this.setRailOpen(true, false);
      return;
    }
    if (this.railOpen) this.setRailOpen(false, false);
    if (r === 'steps') {
      this.root.dataset.sheet = 'steps';
      this.refreshSteps();
      this.paintBar();
      const first = this.inspector.querySelector('button:not([hidden]), [tabindex="0"]');
      if (first) first.focus();
      return;
    }
    this.setPane(r);
  }

  paintBar() {
    const sheet = this.root.dataset.sheet === 'steps';
    const pane = this.main.dataset.pane;
    this.codeBtn.setAttribute('aria-pressed', String(!this.railOpen && !sheet && pane === 'code'));
    this.stepsBtn.setAttribute('aria-pressed', String(sheet));
    this.resultBtn.setAttribute('aria-pressed', String(!this.railOpen && !sheet && pane === 'result'));
  }

  paintBarProblems(counts) {
    const n = counts.error + counts.warning + counts.info;
    this.barProblems.textContent = S.problems.count(n);
    this.barProblems.classList.toggle('has-errors', counts.error > 0);
    this.barProblems.hidden = false;
    this.dock.badge('problems', n || null);
    if (this.dock.current === 'problems' && this.problemsView) this.problemsView.paint();
  }

  narrow() {
    return window.matchMedia('(max-width: 1023px)').matches;
  }

  toggleNavigator() {
    if (this.narrow()) {
      this.setRailOpen(!this.railOpen, false);
      return true;
    }
    const collapse = this.root.dataset.nav !== 'collapsed';
    this.root.dataset.nav = collapse ? 'collapsed' : 'expanded';
    if (collapse) this.navRail.btn.focus();
    else if (!this.nav.focusStop()) this.rail.querySelector('input')?.focus();
    return true;
  }

  toggleDock() {
    if (window.matchMedia('(max-width: 639px)').matches) return false;
    const collapse = this.main.dataset.dock !== 'collapsed';
    const inside = this.resultPanel.contains(document.activeElement) || this.dockToggle === document.activeElement;
    this.main.dataset.dock = collapse ? 'collapsed' : 'expanded';
    this.dockToggle.setAttribute('aria-expanded', String(!collapse));
    if (collapse && inside) this.dockRail.btn.focus();
    else if (!collapse && document.activeElement === this.dockRail.btn) this.dockToggle.focus();
    return true;
  }

  presetsAvailable() {
    return !window.matchMedia('(max-width: 1099px)').matches;
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return false;
    if (!this.presetsAvailable()) {
      this.status.set({ note: S.presetNarrow });
      return false;
    }
    if ((this.root.dataset.nav !== 'collapsed') !== p.navigator) this.toggleNavigator();
    if ((this.root.dataset.inspector === 'open') !== p.inspector) this.toggleInspector();
    if ((this.main.dataset.dock !== 'collapsed') !== p.dock.open) this.toggleDock();
    if (p.dock.open) {
      const split = dockSplit(p.dock.percent);
      this.main.style.setProperty('--top', `${split.top}fr`);
      this.main.style.setProperty('--bottom', `${split.bottom}fr`);
      this.splitter.setAttribute('aria-valuenow', String(split.top));
      this.dock.show(p.dock.tab);
    }
    this.status.set({ note: S.presetApplied(S.presets[name]) });
    return true;
  }

  async openSources() {
    const inventory = sourcesOfSection(this.session.currentSectionText());
    await sourcesDialog({
      inventory,
      boundName: (key) => {
        const b = this.session.bindings.get(key);
        return b ? b.name : null;
      },
      choose: async (key, kind, file) => {
        try {
          await this.session.addBinding(key, file);
          this.renderSources();
          return true;
        } catch {
          return false;
        }
      },
      clearBinding: (key) => {
        this.session.bindings.delete(key);
        this.renderSources();
      }
    });
    return true;
  }

  async preflightSources(mode, options) {
    const index = this.orchestrator.refresh();
    const plan = planRun(index, mode, { ...options, statuses: this.orchestrator.statuses() });
    const planned = plan.kind === 'steps' ? [plan.name] : plan.names || [];
    if (!planned.length) return true;
    const names = [...new Set([...planned, ...upstreamOf(index, planned)])];
    const inventory = sourcesOfSection(this.session.currentSectionText());
    const missing = unboundFor(inventory, names, new Set(this.session.bindings.keys()));
    if (!missing.length) return true;
    const choice = await unboundDialog(missing);
    if (!choice) return false;
    if (choice === 'bind') await this.openSources();
    return true;
  }

  openChangesTab() {
    if (this.main.dataset.dock === 'collapsed') this.toggleDock();
    this.dock.show('changes');
    return true;
  }

  cycleRegion(dir) {
    if (!this.regions) {
      const r = S.panes.regions;
      const list = [
        { id: 'navigator', label: r.navigator, el: this.rail, focus: () => (this.root.dataset.nav === 'collapsed' ? this.navRail.btn : this.nav.focusStop() ? document.activeElement : null) },
        { id: 'editor', label: r.editor, el: this.groupsEl, focus: () => this.editor.textarea },
        { id: 'inspector', label: r.inspector, el: this.inspector, focus: () => (this.root.dataset.inspector === 'closed' ? this.inspRail.btn : null) },
        { id: 'dock', label: r.dock, el: this.resultPanel, focus: () => (this.main.dataset.dock === 'collapsed' ? this.dockRail.btn : null) }
      ];
      if (this.readoutEl) list.push({ id: 'readout', label: r.readout, el: this.readoutEl, focus: null });
      this.regions = new Regions(list);
    }
    return this.regions.cycle(dir);
  }

  selectedQueryNames() {
    return this.nav ? this.nav.selectedItems().filter((i) => i.type === 'query').map((i) => i.name) : [];
  }

  runSelected(downstream) {
    const names = this.selectedQueryNames();
    if (!names.length) {
      this.status.set({ note: S.panes.selectFirst });
      return false;
    }
    this.runSelection(names, downstream);
    return true;
  }

  openRunMenu() {
    const isQuery = !!this.item && this.item.type === 'query';
    const entries = [
      { label: S.panes.runSelectedItems, disabled: !this.selectedQueryNames().length, run: () => this.runSelected(false) },
      { label: S.panes.runDownstreamItems, disabled: !isQuery, run: () => this.runBatch('run-downstream') },
      { label: S.panes.runStaleItems, run: () => this.runBatch('run-stale') },
      { label: S.panes.runAllItems, run: () => this.runBatch('run-all') }
    ];
    this.moreRunBtn.setAttribute('aria-expanded', 'true');
    menu(this.moreRunBtn, entries, () => this.moreRunBtn.setAttribute('aria-expanded', 'false'));
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
    this.nav.onRefresh = () => this.paintTabs();
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
      open: (item, needle, permanent) => this.openAt(item, needle, permanent),
      run: (names, downstream) => this.runSelection(names, downstream),
      revert: (items) => this.revertItems(items),
      graph: (name) => this.openGraph(name),
      collapse: () => this.toggleNavigator(),
      notify: (note) => this.status.set({ note })
    };
  }

  linkedQueries() {
    if (!this.session.modules.length) return new Set();
    return new Set(refreshedBy(this.allPqLinks(), this.linkContext()).keys());
  }

  openAt(item, needle, permanent) {
    this.select(item, { preview: !permanent && !needle });
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
    if (!(await this.preflightSources('run-selected', { selection }))) return;
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
    this.paintTabs();
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
    this.select(all[(i + dir + all.length) % all.length], { preview: true });
  }

  selectFirst() {
    const all = this.items();
    if (all.length) this.select(all[0], { preview: true });
    else this.showNothing();
  }

  showNothing() {
    this.item = null;
    this.title.textContent = S.noSelection;
    this.meta.textContent = '';
    this.main.hidden = false;
  }

  select(item, { preview = false, force = true } = {}) {
    this.saveMemory();
    this.tabs.open(item, { preview });
    this.applyTabState({ force, restore: keyOf(item) });
  }

  present(item, grp) {
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
    this.stepsBtn.textContent = isQuery ? S.stepsPanel.toggle : S.outline.title;
    this.inspectorToggle.setAttribute('aria-label', isQuery ? S.stepsPanel.toggleAria : S.outline.toggleAria);
    this.stepResults = new Map();
    this.runbar.hidden = !isQuery;
    this.syncDock();
    this.segmented.hidden = !isQuery;
    this.title.textContent = item.name;
    this.loadInto(grp, item);
    this.refreshSteps();
    this.refreshOutline();
    const ed = isQuery ? s.queryEditable() : s.moduleEditable(item.name);
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

  loadInto(group, item) {
    const s = this.session;
    const isQuery = item.type === 'query';
    const key = keyOf(item);
    const ed = group.editor;
    ed.setLanguage(isQuery ? 'm' : 'vba');
    ed.setLabel(S.editorAriaFor(isQuery ? S.editorAria : S.moduleAria, item.name));
    const text = s.textOf(item);
    let loaded = false;
    if (group.shownKey !== key || ed.getText() !== text) {
      ed.setText(text);
      loaded = true;
    }
    ed.setError(null);
    const e = isQuery ? s.queryEditable() : s.moduleEditable(item.name);
    ed.setReadOnly(!e.editable);
    group.shownKey = key;
    return loaded;
  }

  addGroup() {
    const group = { shownKey: null };
    group.strip = new TabStrip(S.tabs.group(this.groups.length + 1), this.stripActions(group));
    const host = h('div', { class: 'editor-host' });
    group.el = h('div', { class: 'editor-group', 'data-group': String(this.groups.length) }, group.strip.el, host);
    group.editor = new Editor(host, { language: 'm', label: S.editorAria, onChange: (t) => this.onEditorChange(t) });
    group.editor.textarea.addEventListener('keyup', () => this.syncCaretStep());
    group.editor.textarea.addEventListener('mouseup', () => this.syncCaretStep());
    group.el.addEventListener('focusin', () => this.focusGroup(this.groups.indexOf(group)));
    for (const t of ['dragenter', 'dragover']) {
      group.el.addEventListener(t, (ev) => {
        if (this.dragKey && this.tabs.groupOf(this.dragKey) !== this.groups.indexOf(group)) {
          ev.preventDefault();
          group.el.dataset.drop = 'true';
        }
      });
    }
    group.el.addEventListener('dragleave', (ev) => {
      if (!group.el.contains(ev.relatedTarget)) delete group.el.dataset.drop;
    });
    group.el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.dropOn(this.groups.indexOf(group));
    });
    this.groups.push(group);
    this.groupsEl.append(group.el);
    return group;
  }

  stripActions(group) {
    return {
      activate: (key) => this.activateTab(key),
      close: (key) => this.closeTab(key),
      permanent: (key) => {
        if (this.tabs.makePermanent(key)) this.paintTabs();
      },
      menu: (key, anchor) => this.tabMenu(key, anchor),
      dragStart: (key) => this.beginDrag(key),
      dragEnd: () => this.endDrag()
    };
  }

  wide() {
    return window.matchMedia('(min-width: 900px)').matches;
  }

  syncGroups(removed) {
    if (this.groups.length > this.tabs.groups.length) {
      const at = removed === null || removed === undefined ? this.groups.length - 1 : removed;
      const [gone] = this.groups.splice(at, 1);
      gone.el.remove();
    }
    while (this.groups.length < this.tabs.groups.length) this.addGroup();
    this.groups.forEach((g, i) => {
      g.el.dataset.group = String(i);
      g.strip.setLabel(S.tabs.group(i + 1));
    });
  }

  applyTabState({ force = true, restore = null } = {}) {
    const gi = this.tabs.activeGroup;
    const grp = this.groups[gi];
    const item = this.tabs.activeItem();
    this.editor = grp.editor;
    this.groups.forEach((g, i) => {
      if (i === gi) return;
      const key = this.tabs.groups[i].active;
      const hit = key ? this.tabs.find(key) : null;
      if (hit && g.shownKey !== key) this.loadInto(g, hit.tab.item);
    });
    if (item) {
      const key = keyOf(item);
      const same = this.item && keyOf(this.item) === key && grp.shownKey === key;
      if (force || !same) {
        this.present(item, grp);
        if (restore) this.restoreMemory(restore);
      }
    }
    this.paintTabs();
  }

  saveMemory() {
    if (!this.item || !this.editor) return;
    const ta = this.editor.textarea;
    this.tabs.remember(keyOf(this.item), { scrollTop: ta.scrollTop, scrollLeft: ta.scrollLeft, start: ta.selectionStart, end: ta.selectionEnd });
  }

  restoreMemory(key) {
    const m = this.tabs.recall(key);
    if (!m) return;
    const ta = this.editor.textarea;
    ta.setSelectionRange(m.start, m.end);
    ta.scrollTop = m.scrollTop;
    ta.scrollLeft = m.scrollLeft;
  }

  paintTabs() {
    const map = this.nav && this.nav.statusMap ? this.nav.statusMap : new Map();
    const only = this.tabs.groups.length === 1 && this.tabs.groups[0].tabs.length === 1;
    this.tabs.groups.forEach((g, i) => {
      const grp = this.groups[i];
      if (!grp) return;
      grp.el.dataset.active = String(i === this.tabs.activeGroup);
      grp.strip.set(g.tabs, g.active, (t) => ({ status: t.item.type === 'query' ? map.get(t.item.name) || 'never' : null, edited: this.session.isEdited(t.item) }), only);
    });
  }

  syncInactive() {
    this.groups.forEach((g, i) => {
      if (i === this.tabs.activeGroup || !g.shownKey) return;
      const hit = this.tabs.find(g.shownKey);
      if (!hit) return;
      const text = this.session.textOf(hit.tab.item);
      if (g.editor.getText() !== text) g.editor.setText(text);
    });
  }

  focusGroup(i) {
    if (i < 0 || i === this.tabs.activeGroup) return;
    this.saveMemory();
    this.tabs.focusGroup(i);
    this.applyTabState({ force: true });
  }

  activateTab(key) {
    this.saveMemory();
    if (!this.tabs.activate(key)) return;
    this.applyTabState({ force: true, restore: key });
    this.editor.focus();
  }

  canCloseTab() {
    const only = this.tabs.groups.length === 1 && this.tabs.groups[0].tabs.length === 1;
    return only ? S.tabs.only : true;
  }

  closeTab(key = this.tabs.active) {
    if (!key || this.canCloseTab() !== true) return false;
    this.saveMemory();
    this.tabs.close(key);
    this.syncGroups(this.tabs.lastRemoved);
    this.applyTabState({ force: false, restore: this.tabs.active });
    return true;
  }

  cycleTab(dir) {
    this.saveMemory();
    const key = this.tabs.cycle(dir);
    if (!key) return false;
    this.applyTabState({ force: true, restore: key });
    return true;
  }

  goTab(n) {
    this.saveMemory();
    const key = this.tabs.goTo(n);
    if (!key) return false;
    this.applyTabState({ force: true, restore: key });
    return true;
  }

  canSplit() {
    if (this.tabs.groups.length > 1) return true;
    if (!this.wide()) return S.tabs.narrow;
    return this.tabs.canSplit() === true ? true : S.tabs.fewerThanTwo;
  }

  toggleSplit() {
    const why = this.canSplit();
    if (why !== true) {
      this.status.set({ note: why });
      return false;
    }
    this.saveMemory();
    this.tabs.toggleSplit();
    this.syncGroups(this.tabs.lastRemoved);
    this.applyTabState({ force: true, restore: this.tabs.active });
    return true;
  }

  moveTab(key, g) {
    if (g >= this.tabs.groups.length && !this.wide()) {
      this.status.set({ note: S.tabs.narrow });
      return false;
    }
    this.saveMemory();
    if (!this.tabs.move(key, g)) return false;
    this.syncGroups(this.tabs.lastRemoved);
    this.applyTabState({ force: true, restore: key });
    return true;
  }

  beginDrag(key) {
    this.dragKey = key;
    if (this.tabs.groups.length === 1 && this.tabs.groups[0].tabs.length >= 2 && this.wide()) {
      setTimeout(() => {
        if (this.dragKey) this.dropSplit.hidden = false;
      }, 0);
    }
  }

  endDrag() {
    this.dragKey = null;
    this.dropSplit.hidden = true;
    for (const g of this.groups) delete g.el.dataset.drop;
  }

  dropOn(g) {
    const key = this.dragKey;
    this.endDrag();
    if (key) this.moveTab(key, g);
  }

  tabMenu(key, anchor) {
    const hit = this.tabs.find(key);
    if (!hit) return;
    const two = this.tabs.groups.length > 1;
    const entries = [
      { label: S.tabs.closeTab, disabled: this.canCloseTab() !== true, run: () => this.closeTab(key) },
      { label: S.tabs.keepOpen, disabled: !hit.tab.preview, run: () => this.tabs.makePermanent(key) && this.paintTabs() },
      two
        ? { label: S.tabs.moveOther, run: () => this.moveTab(key, hit.g === 0 ? 1 : 0) }
        : { label: S.tabs.splitRight, disabled: this.tabs.groups[0].tabs.length < 2 || !this.wide(), run: () => this.moveTab(key, 1) },
      { label: S.tabs.join, disabled: !two, run: () => this.toggleSplit() }
    ];
    menu(anchor, entries);
  }

  onEditorChange(text) {
    if (!this.item) return;
    const s = this.session;
    s.setText(this.item, text);
    this.revertBtn.hidden = !s.isEdited(this.item);
    this.tabs.makePermanent(keyOf(this.item));
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
    this.resetView();
    this.resultHead.hidden = true;
    this.exportBtn.hidden = true;
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
    this.lastStep = step || null;
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
    this.renderResult(res, !!step, res.resultId || null);
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
    this.currentResult = null;
    this.pinBtn.hidden = true;
    this.exportBtn.hidden = true;
    this.resetView();
    this.resultHead.hidden = true;
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
      if (resultId) {
        this.currentResult = { id: resultId, query: this.item.name, step: isStep ? this.lastStep : null, columns: t.columns, rowCount: t.rowCount, at: Date.now() };
        this.pinBtn.hidden = false;
        this.attachColumnTools(resultId);
      }
      this.showResultHead(t, res, isStep, resultId);
      this.status.set({ run: { rows: t.rowCount, secs }, compare: isStep ? null : res.compare, flags: res.flags });
      this.pendingDiffs = res.compare && res.compare.diffs ? new Set(res.compare.diffs.map(([row, col]) => `${row}:${col}`)) : null;
      this.diffLabel.hidden = !(res.compare && res.compare.count > 0);
      this.diffBtn.hidden = this.diffLabel.hidden;
      this.diffBox.checked = false;
      return;
    }
    this.showValue(r.value, r.kind, secs, res.flags);
  }

  stepOfResult(resultId) {
    const model = this.stepsModel;
    if (!this.hasSteps() || !model || !model.steps.length) return null;
    let name = null;
    if (resultId) for (const [n, r] of this.stepResults) if (r && r.resultId === resultId) name = n;
    const at = name ? model.steps.findIndex((x) => x.name === name) : model.steps.length - 1;
    return at < 0 ? null : { index: at + 1, total: model.steps.length };
  }

  showResultHead(t, res, isStep, resultId) {
    const f = formatsFor(this.settings.culture);
    const parts = [S.resultHead.rows(t.rowCount, f.integer.format(t.rowCount)), S.resultHead.cols(t.columns.length)];
    if (res.durationMs !== undefined && res.durationMs !== null) parts.push(S.resultHead.ms(f.integer.format(Math.round(res.durationMs))));
    const at = this.stepOfResult(resultId);
    if (at) parts.push(S.resultHead.step(at.index, at.total));
    this.headLine.textContent = parts.join(' · ');
    const c = isStep ? null : res.compare;
    let text = '';
    let kind = '';
    if (c) {
      if (c.disabled) text = c.disabled === 'time' ? S.compareTime : S.compareRandom;
      else if (c.reason === 'columns') text = S.compareColumns;
      else if (c.matches) {
        text = S.matchesCache;
        kind = 'ok';
      } else {
        text = c.reason === 'rows' ? S.rowCountDiffers(f.integer.format(c.got), f.integer.format(c.expected)) : S.cellsDiffer(f.integer.format(c.count));
        kind = 'diff';
      }
    }
    this.verdict.className = kind ? `chip ${kind}` : 'chip';
    this.verdict.textContent = text;
    this.verdict.title = text;
    this.verdict.hidden = !text;
    this.exportBtn.hidden = !resultId;
    this.resultHead.hidden = false;
  }

  openResultExport() {
    const id = this.shownResultId();
    if (!id) return;
    const viewing = !!(this.view && this.view.viewId);
    const entries = [
      viewing ? { heading: true, label: S.resultHead.exportView } : { heading: true, label: S.exportResult },
      { label: S.exportCsv, run: () => this.exportShown('csv', '.csv') },
      { label: S.exportCsvBom, run: () => this.exportShown('csvbom', '.csv') },
      { label: S.exportTsv, run: () => this.exportShown('tsv', '.tsv') },
      { label: S.exportJson, run: () => this.exportShown('json', '.json') },
      { label: S.exportXlsx, run: () => this.exportShown('xlsx', '.xlsx') }
    ];
    menu(this.exportBtn, entries);
  }

  async exportShown(format, ext) {
    const id = this.shownResultId();
    if (!id || !this.onSave || !this.item) return;
    const res = await this.runner.export(format, { guard: this.settings.csvGuard }, id);
    if (res.error || !res.bytes) {
      this.status.set({ note: S.resultHead.exportFailed });
      return;
    }
    this.onSave(res.bytes, sanitizeFileName(this.item.name, ext), res.mime);
  }

  resetView() {
    const v = this.view;
    this.view = null;
    if (v && v.viewId) this.runner.release(v.viewId);
    this.grid.columnTools = null;
    this.viewChip.hidden = true;
    this.viewClear.hidden = true;
    this.viewSteps.hidden = true;
  }

  attachColumnTools(resultId) {
    this.view = { baseId: resultId, viewId: null, filters: [], hidden: [] };
    this.grid.columnTools = {
      filter: (col) => this.openViewFilter(col),
      hide: (col) => this.view && this.applyView({ filters: this.view.filters, hidden: [...this.view.hidden, col.name] }),
      profile: (col) => this.openProfile(col),
      canAddStep: () => this.addStepTarget() !== null,
      addStep: (col) => this.openAddStep(col)
    };
  }

  shownResultId() {
    return this.view ? this.view.viewId || this.view.baseId : null;
  }

  withFilter(spec) {
    return { filters: [...this.view.filters.filter((f) => f.column !== spec.column), spec], hidden: this.view.hidden };
  }

  openViewFilter(col) {
    const id = this.shownResultId();
    if (!id) return;
    filterDialog({
      column: col.name,
      type: col.type,
      loadValues: () => this.runner.profile(id, col.name, 200),
      onApply: (spec) => this.view && this.applyView(this.withFilter(spec))
    });
  }

  async applyView(next) {
    const v = this.view;
    if (!v) return;
    if (!next.filters.length && !next.hidden.length) {
      this.clearView();
      return;
    }
    const res = await this.runner.view(v.baseId, next, 200);
    if (this.view !== v) {
      if (res.viewResultId) this.runner.release(res.viewResultId);
      return;
    }
    if (res.error) {
      this.status.set({ note: res.error === 'evicted' ? S.colTools.gone : res.message || S.colTools.viewFailed });
      return;
    }
    const old = v.viewId;
    v.viewId = res.viewResultId;
    v.filters = next.filters;
    v.hidden = next.hidden;
    this.showTable({ columns: res.columns, rowCount: res.rowCount, rows: res.rows, truncated: false }, true, res.viewResultId);
    if (old) this.runner.release(old);
    const f = formatsFor(this.settings.culture).integer;
    const parts = [S.colTools.viewOnly, S.colTools.viewRows(f.format(res.rowCount), f.format(res.sourceRows))];
    if (v.filters.length) parts.push(S.colTools.viewFilters(v.filters.length));
    if (v.hidden.length) parts.push(S.colTools.viewHidden(v.hidden.length));
    this.viewChip.textContent = parts.join(' · ');
    this.viewChip.hidden = false;
    this.viewClear.hidden = false;
    this.viewSteps.hidden = this.addStepTarget() === null;
    this.viewNote.textContent = S.colTools.viewApplied(f.format(res.rowCount), f.format(res.sourceRows));
  }

  clearView() {
    const v = this.view;
    if (!v) return;
    if (v.viewId) this.runner.release(v.viewId);
    v.viewId = null;
    v.filters = [];
    v.hidden = [];
    this.viewChip.hidden = true;
    this.viewClear.hidden = true;
    this.viewSteps.hidden = true;
    const r = this.lastResult;
    if (r && r.status === 'ok' && r.result && r.result.value) this.showTable(r.result.value, true, v.baseId);
    this.viewNote.textContent = S.colTools.viewCleared;
  }

  openProfile(col) {
    const id = this.shownResultId();
    if (!id) return;
    profileSheet({
      column: col.name,
      columnType: col.type,
      load: () => this.runner.profile(id, col.name),
      formats: formatsFor(this.settings.culture),
      onFilter: (spec) => this.view && this.applyView(this.withFilter(spec))
    });
  }

  addStepTarget() {
    if (!this.hasSteps() || !this.currentResult || !this.view) return null;
    if (this.currentResult.query !== this.item.name) return null;
    const steps = this.stepsModel.steps;
    let name = null;
    for (const [n, r] of this.stepResults) if (r && r.resultId === this.view.baseId) name = n;
    return (name ? steps.find((x) => x.name === name) : steps[steps.length - 1]) || null;
  }

  addViewAsSteps() {
    const v = this.view;
    const st = this.addStepTarget();
    if (!v || !st || (!v.filters.length && !v.hidden.length)) return;
    const res = insertViewSteps(this.editor.getText(), st.index, { filters: v.filters, hidden: v.hidden }, { prevName: st.name, existing: this.stepsModel.steps.map((x) => x.name), names: S.stepNames });
    const last = res.ok ? res.added[res.added.length - 1] : null;
    if (!this.applySteps(res, S.colTools.viewStepsAdded(res.ok ? res.added.length : 0), last, false)) return;
    const added = this.stepsModel.steps.find((x) => x.name === last);
    if (added) this.editor.goto(this.lineOfOffset(this.editor.getText(), added.parts.coreStart), 1);
    this.runSteps(last);
  }

  openAddStep(col) {
    const st = this.addStepTarget();
    if (!st) {
      this.status.set({ note: S.colTools.stepNoPlace });
      return;
    }
    stepDialog({
      column: col.name,
      type: col.type,
      prevName: st.name,
      existing: this.stepsModel.steps.map((x) => x.name),
      onInsert: ({ name, expr }) => {
        const t = this.editor.getText();
        const wired = insertStepAfter(t, st.index, name, expr, { rewire: true });
        const res = wired.ok ? wired : insertStepAfter(t, st.index, name, expr);
        if (!res.ok) return { ok: false, reason: res.reason };
        if (!this.applySteps(res, S.colTools.stepInserted(name), name, false)) return { ok: false, reason: S.colTools.viewFailed };
        const added = this.stepsModel.steps.find((x) => x.name === name);
        if (added) this.editor.goto(this.lineOfOffset(this.editor.getText(), added.parts.coreStart), 1);
        this.runSteps(name);
        return { ok: true };
      }
    });
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
    if (!remote) this.grid.columnTools = null;
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
