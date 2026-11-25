export const PRESET_ORDER = ['write', 'debug', 'review'];

export const PRESETS = Object.freeze({
  write: Object.freeze({ navigator: true, inspector: false, dock: Object.freeze({ open: false }) }),
  debug: Object.freeze({ navigator: false, inspector: true, dock: Object.freeze({ open: true, tab: 'result', percent: 50 }) }),
  review: Object.freeze({ navigator: false, inspector: false, dock: Object.freeze({ open: true, tab: 'changes', percent: 70 }) })
});

export function dockSplit(percent) {
  const dock = Math.max(15, Math.min(85, percent));
  return { top: 100 - dock, bottom: dock };
}
