const SETTLED = ['ready', 'done', 'doneWithFailures'];

export class SetSession {
  constructor() {
    this.state = 'empty';
    this.move = null;
    this.files = new Map();
    this.listeners = new Set();
    this.counter = 0;
    this.runProgress = null;
    this.failedBeforeRun = new Set();
  }

  get progress() {
    return this.runProgress ? { ...this.runProgress } : null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of [...this.listeners]) fn(event);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  setMove(move) {
    if (this.move === move) return;
    this.move = move;
    this.emit({ type: 'move', move });
  }

  setRunProgress(progress) {
    this.runProgress = progress;
    this.emit({ type: 'progress', progress: this.progress });
  }

  guard(action, states, moves = [null]) {
    if (!states.includes(this.state) || !moves.includes(this.move)) throw new Error(`cannot ${action} while ${this.state} (move: ${this.move || 'none'})`);
  }

  require(action, state) {
    if (this.state !== state) throw new Error(`${action} requires ${state}, state is ${this.state}`);
  }

  badgeOf(rec) {
    if (rec.status === 'pending') return null;
    if (rec.error !== null || rec.status === 'failed') return 'failed';
    if (rec.skipReason !== null || rec.status === 'refused') return 'skipped';
    return rec.edited ? 'edited' : 'ready';
  }

  view(rec) {
    return { ...rec, badge: this.badgeOf(rec) };
  }

  list() {
    return [...this.files.values()].map((r) => this.view(r));
  }

  file(id) {
    const rec = this.files.get(id);
    return rec ? this.view(rec) : null;
  }

  index(id) {
    const rec = this.files.get(id);
    return rec ? rec.index : null;
  }

  counts() {
    const out = { files: this.files.size, queries: 0, ready: 0, edited: 0, skipped: 0, failed: 0, pending: 0 };
    for (const rec of this.files.values()) {
      const badge = this.badgeOf(rec);
      if (badge === null) out.pending++;
      else out[badge]++;
      if (rec.index && rec.index.status === 'ready') out.queries += rec.index.queries.length;
    }
    return out;
  }

  addFiles(refs) {
    this.guard('add files', ['empty', 'indexing', ...SETTLED], [null, 'drop']);
    const keyOf = (r) => `${r.relPath}\u0000${r.size}\u0000${r.lastModified}`;
    const seen = new Set([...this.files.values()].map(keyOf));
    const added = [];
    let duplicates = 0;
    for (const r of refs) {
      if (seen.has(keyOf(r))) {
        duplicates++;
        continue;
      }
      seen.add(keyOf(r));
      const id = `f${String(++this.counter).padStart(4, '0')}`;
      this.files.set(id, { id, name: r.name, relPath: r.relPath, size: r.size, lastModified: r.lastModified, file: r.file, status: 'pending', index: null, skipReason: null, error: null, edited: false });
      added.push(id);
    }
    if (!added.length) return { added: 0, duplicates };
    this.emit({ type: 'files', added });
    this.setMove('drop');
    this.setState('indexing');
    return { added: added.length, duplicates };
  }

  settle(id, change) {
    const rec = this.files.get(id);
    if (!rec) return false;
    Object.assign(rec, change);
    this.emit({ type: 'file', id });
    this.finishIndexing();
    return true;
  }

  finishIndexing() {
    if (this.state !== 'indexing' || [...this.files.values()].some((r) => r.status === 'pending')) return;
    this.setState('ready');
    this.setMove(null);
  }

  indexed(id, index) {
    return this.settle(id, { status: 'ready', index });
  }

  refused(id, code) {
    return this.settle(id, { status: 'refused', skipReason: code });
  }

  failed(id, error) {
    return this.settle(id, { status: 'failed', error });
  }

  mark(id, change) {
    const rec = this.files.get(id);
    if (!rec) return false;
    Object.assign(rec, change);
    this.emit({ type: 'file', id });
    return true;
  }

  setEdited(id, edited) {
    return this.mark(id, { edited: !!edited });
  }

  markSkipped(id, reason) {
    return this.mark(id, { skipReason: reason });
  }

  markFailed(id, error) {
    return this.mark(id, { error });
  }

  removeFile(id) {
    if (this.move === 'get') throw new Error(`cannot remove a file while ${this.state} (move: get)`);
    if (!this.files.delete(id)) return false;
    this.emit({ type: 'files', removed: [id] });
    if (this.files.size === 0) this.reset();
    else this.finishIndexing();
    return true;
  }

  clear() {
    if (this.move === 'get') throw new Error(`cannot clear while ${this.state} (move: get)`);
    const removed = [...this.files.keys()];
    if (!removed.length) return;
    this.files.clear();
    this.emit({ type: 'files', removed });
    this.reset();
  }

  reset() {
    this.setState('empty');
    this.setMove(null);
  }

  beginChoose() {
    this.guard('choose', SETTLED);
    this.setMove('choose');
    this.setState('ready');
  }

  endChoose() {
    if (this.move !== 'choose') throw new Error(`endChoose requires the choose move, move is ${this.move || 'none'}`);
    this.setMove(null);
  }

  beginPreview() {
    this.guard('preview', ['ready']);
    this.setMove('get');
    this.setState('previewing');
  }

  endPreview() {
    this.require('endPreview', 'previewing');
    this.setState('ready');
    this.setMove(null);
  }

  beginRun(total) {
    this.guard('run', ['ready']);
    this.failedBeforeRun = new Set(this.list().filter((f) => f.badge === 'failed').map((f) => f.id));
    this.setMove('get');
    this.setState('running');
    this.setRunProgress({ done: 0, total });
  }

  setProgress(done) {
    this.require('setProgress', 'running');
    const total = this.runProgress.total;
    this.setRunProgress({ done: Math.max(0, Math.min(total, done)), total });
  }

  finishRun() {
    this.require('finishRun', 'running');
    const newFailures = this.list().filter((f) => f.badge === 'failed' && !this.failedBeforeRun.has(f.id));
    this.setState(newFailures.length ? 'doneWithFailures' : 'done');
    this.setMove(null);
    this.setRunProgress(null);
  }

  abort() {
    if (this.state !== 'previewing' && this.state !== 'running') return false;
    this.setState('ready');
    this.setMove(null);
    if (this.runProgress) this.setRunProgress(null);
    return true;
  }
}
