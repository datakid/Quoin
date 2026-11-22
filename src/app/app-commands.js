import { CommandRegistry } from './commands.js';

const inField = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);

export function buildRegistry(app) {
  const r = new CommandRegistry();
  const needsFile = (a) => (a.ws ? true : 'Open a workbook first.');
  r.register({ id: 'openFile', keys: ['Mod+O'], surfaces: ['T3'], run: (a) => a.input.click() });
  r.register({ id: 'run', keys: ['Mod+Enter'], surfaces: ['T1'], enabled: needsFile, run: (a) => (a.ws ? a.ws.run() : false) });
  r.register({ id: 'runStale', keys: ['Mod+Shift+Enter'], surfaces: ['T3'], enabled: needsFile, run: (a) => (a.ws ? a.ws.runBatch('run-stale') : false) });
  r.register({ id: 'runAll', keys: ['Mod+Alt+Enter'], surfaces: ['T3'], enabled: needsFile, run: (a) => (a.ws ? a.ws.runBatch('run-all') : false) });
  r.register({ id: 'runDownstream', keys: [], surfaces: ['T3'], enabled: (a) => (a.ws && a.ws.item && a.ws.item.type === 'query' ? true : 'Open a query first.'), run: (a) => (a.ws ? a.ws.runBatch('run-downstream') : false) });
  r.register({ id: 'cancel', keys: ['Escape'], surfaces: ['T1'], enabled: (a) => (a.ws && a.ws.runner.running ? true : 'Nothing is running.'), run: (a) => (a.ws ? a.ws.cancel() : false) });
  r.register({ id: 'download', keys: ['Mod+S'], surfaces: ['T1'], enabled: needsFile, run: (a) => a.ws && a.openDownload() });
  r.register({ id: 'export', keys: ['Mod+Shift+E'], surfaces: ['T3'], enabled: needsFile, run: (a) => a.ws && a.openExport() });
  r.register({ id: 'prevItem', keys: ['Alt+ArrowUp'], surfaces: ['T2'], enabled: needsFile, run: (a) => a.ws && a.ws.step(-1) });
  r.register({ id: 'nextItem', keys: ['Alt+ArrowDown'], surfaces: ['T2'], enabled: needsFile, run: (a) => a.ws && a.ws.step(1) });
  r.register({ id: 'closeTab', keys: ['Alt+W'], surfaces: ['T2'], enabled: (a) => (a.ws ? a.ws.canCloseTab() : 'Open a workbook first.'), run: (a) => (a.ws ? a.ws.closeTab() : false) });
  r.register({ id: 'prevTab', keys: ['Alt+['], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.cycleTab(-1) : false) });
  r.register({ id: 'nextTab', keys: ['Alt+]'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.cycleTab(1) : false) });
  r.register({ id: 'goTab', keys: Array.from({ length: 9 }, (_, i) => `Alt+${i + 1}`), shortcutLabel: 'Alt+1 to Alt+9', surfaces: ['T2'], enabled: needsFile, run: (a, ev) => (a.ws && ev ? a.ws.goTab(Number(ev.code.slice(5))) : false) });
  r.register({ id: 'splitEditor', keys: ['Mod+\\'], surfaces: ['T2'], enabled: (a) => (a.ws ? a.ws.canSplit() : 'Open a workbook first.'), run: (a) => (a.ws ? a.ws.toggleSplit() : false) });
  r.register({ id: 'print', keys: ['Mod+P'], surfaces: ['T1'], enabled: needsFile, run: (a) => a.ws && a.openPrint() });
  r.register({ id: 'toggleNavigator', keys: ['Mod+B'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.toggleNavigator() : false) });
  r.register({ id: 'toggleDock', keys: ['Mod+J'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.toggleDock() : false) });
  r.register({ id: 'focusNext', keys: ['F6'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.cycleRegion(1) : false) });
  r.register({ id: 'focusPrev', keys: ['Shift+F6'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.cycleRegion(-1) : false) });
  r.register({ id: 'runSelected', keys: [], surfaces: ['T3'], enabled: (a) => (a.ws && a.ws.selectedQueryNames().length ? true : 'Select queries in the list first.'), run: (a) => (a.ws ? a.ws.runSelected(false) : false) });
  r.register({ id: 'toggleInspector', keys: ['Mod+Alt+B'], surfaces: ['T2'], enabled: needsFile, run: (a) => (a.ws ? a.ws.toggleInspector() : false) });
  r.register({ id: 'problems', keys: [], surfaces: ['T1'], enabled: needsFile, run: (a) => (a.ws ? a.ws.openProblems() : false) });
  r.register({ id: 'find', keys: ['Mod+Shift+F'], surfaces: ['T3'], enabled: needsFile, run: (a) => (a.ws ? a.ws.openFind(false) : false) });
  r.register({ id: 'replace', keys: ['Mod+Alt+F'], surfaces: ['T3'], enabled: needsFile, run: (a) => (a.ws ? a.ws.openFind(true) : false) });
  r.register({ id: 'graph', keys: [], surfaces: ['T3'], enabled: needsFile, run: (a) => (a.ws ? a.ws.openGraph() : false) });
  r.register({ id: 'palette', keys: ['Mod+K', 'Mod+Shift+P'], surfaces: ['T1'], run: (a) => a.openPalette() });
  r.register({ id: 'shortcuts', keys: ['?'], surfaces: ['T3'], when: () => !inField(), run: (a) => a.openShortcuts() });
  r.register({ id: 'settings', keys: [], surfaces: ['T3'], run: (a) => a.openSettings() });
  return r;
}
