export const HISTORY_LIMIT = 50;

export class OpHistory {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.ops = [];
    this.serial = 0;
  }

  record(label, before, after, at = Date.now()) {
    if (before === after) return null;
    const op = { id: ++this.serial, label, before, after, at };
    this.ops.push(op);
    if (this.ops.length > this.limit) this.ops.splice(0, this.ops.length - this.limit);
    return op;
  }

  latest() {
    return this.ops.length ? this.ops[this.ops.length - 1] : null;
  }

  undoable(currentText) {
    const op = this.latest();
    return op && op.after === currentText ? op : null;
  }

  versions() {
    const out = this.ops.map((op) => ({ id: op.id, label: op.label, text: op.after, at: op.at })).reverse();
    if (this.ops.length) out.push({ id: 0, label: null, text: this.ops[0].before, at: this.ops[0].at });
    return out;
  }

  get size() {
    return this.ops.length;
  }
}
