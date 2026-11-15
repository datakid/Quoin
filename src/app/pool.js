import { validateMessage, cancelMessage, transferListFor } from '../batch/protocol.js';

const MIB = 1024 * 1024;

export const ACK_MS = 1000;

const RESPONSES = { open: ['opened', 'refused'], inspect: ['inspected', 'refused'], apply: ['applied', 'refused'] };

const lowMemory = (deviceMemory) => Number.isFinite(deviceMemory) && deviceMemory <= 4;

export function poolSize(hardwareConcurrency, deviceMemory) {
  const cores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 1;
  const size = Math.min(4, Math.max(1, cores - 1));
  return lowMemory(deviceMemory) ? Math.min(size, 2) : size;
}

export function budgetFor(deviceMemory) {
  return (lowMemory(deviceMemory) ? 384 : 768) * MIB;
}

const defaultTimers = { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };

export class WorkerPool {
  constructor({ createWorker, hardwareConcurrency, deviceMemory, budgetBytes, ackMs = ACK_MS, timers = defaultTimers }) {
    this.createWorker = createWorker;
    this.size = poolSize(hardwareConcurrency, deviceMemory);
    this.budgetBytes = Number.isFinite(budgetBytes) ? budgetBytes : budgetFor(deviceMemory);
    this.ackMs = ackMs;
    this.timers = timers;
    this.slots = [];
    this.queue = [];
    this.inFlight = 0;
    this.seq = 0;
    this.scheduled = false;
    this.destroyed = false;
  }

  stats() {
    return {
      size: this.size,
      budgetBytes: this.budgetBytes,
      workers: this.slots.length,
      idle: this.slots.filter((s) => !s.leased && !s.job).length,
      running: this.slots.filter((s) => s.job).length,
      leased: this.slots.filter((s) => s.leased).length,
      queued: this.queue.length,
      inFlightBytes: this.inFlight
    };
  }

  submit({ message, estimate, onProgress }) {
    return new Promise((resolve) => {
      if (this.destroyed) {
        resolve({ status: 'cancelled' });
        return;
      }
      const checked = validateMessage(message);
      if (!checked.ok || !RESPONSES[message.type]) {
        resolve({ status: 'failed', error: checked.ok ? `${message.type} is not a request` : checked.reason });
        return;
      }
      const ref = message.fileRef;
      this.enqueue({ message, fileId: ref.id, relPath: ref.relPath, bytes: Number.isFinite(estimate) ? estimate : ref.size, onProgress, resolve, cancelling: false, timer: null });
      this.schedule();
    });
  }

  enqueue(job) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].relPath > job.relPath) i--;
    this.queue.splice(i, 0, job);
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    Promise.resolve().then(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  pump() {
    while (!this.destroyed && this.queue.length) {
      const head = this.queue[0];
      if (this.inFlight > 0 && this.inFlight + head.bytes > this.budgetBytes) break;
      let slot = this.slots.find((s) => !s.leased && !s.job);
      if (!slot && this.slots.filter((s) => !s.leased).length < this.size) {
        try {
          slot = this.spawn();
        } catch (e) {
          this.queue.shift();
          head.resolve({ status: 'failed', error: String(e && e.message) });
          continue;
        }
      }
      if (!slot) break;
      this.queue.shift();
      this.start(slot, head);
    }
  }

  spawn() {
    const slot = { worker: this.createWorker(), job: null, leased: false, dead: false };
    this.slots.push(slot);
    this.wire(slot);
    return slot;
  }

  wire(slot) {
    slot.worker.onmessage = (ev) => this.onMessage(slot, ev.data);
    slot.worker.onerror = (ev) => this.onError(slot, ev && ev.message ? ev.message : 'worker error');
  }

  start(slot, job) {
    slot.job = job;
    this.inFlight += job.bytes;
    try {
      slot.worker.postMessage(job.message, transferListFor(job.message));
    } catch (e) {
      this.finish(slot, { status: 'failed', error: String(e && e.message) });
    }
  }

  finish(slot, result) {
    const job = slot.job;
    if (!job) return;
    this.timers.clearTimeout(job.timer);
    slot.job = null;
    this.inFlight -= job.bytes;
    job.resolve(result);
    this.schedule();
  }

  onMessage(slot, m) {
    const job = slot.job;
    if (slot.dead || slot.leased || !job || !m || typeof m !== 'object' || m.fileId !== job.fileId) return;
    if (m.type === 'progress') {
      if (job.onProgress) job.onProgress(m);
      return;
    }
    if (m.type === 'cancelled' || (RESPONSES[job.message.type].includes(m.type) && job.cancelling)) this.finish(slot, { status: 'cancelled' });
    else if (RESPONSES[job.message.type].includes(m.type)) this.finish(slot, { status: 'done', message: m });
  }

  onError(slot, message) {
    if (slot.dead || slot.leased) return;
    this.kill(slot, { status: 'failed', error: message });
  }

  kill(slot, result) {
    slot.dead = true;
    this.slots = this.slots.filter((s) => s !== slot);
    slot.worker.terminate();
    if (slot.job) this.finish(slot, result);
    this.schedule();
  }

  cancel(target) {
    const all = target === 'all';
    this.queue = this.queue.filter((job) => {
      if (!all && job.fileId !== target) return true;
      job.resolve({ status: 'cancelled' });
      return false;
    });
    for (const slot of this.slots) {
      const job = slot.job;
      if (!job || job.cancelling || !(all || job.fileId === target)) continue;
      job.cancelling = true;
      slot.worker.postMessage(cancelMessage(job.fileId));
      job.timer = this.timers.setTimeout(() => {
        if (slot.job === job && !slot.dead) this.kill(slot, { status: 'cancelled' });
      }, this.ackMs);
    }
  }

  lease() {
    let slot = this.slots.find((s) => !s.leased && !s.job);
    if (!slot) slot = this.spawn();
    slot.leased = true;
    let released = false;
    return {
      worker: slot.worker,
      release: ({ terminated = false } = {}) => {
        if (released) return;
        released = true;
        this.endLease(slot, terminated);
      }
    };
  }

  endLease(slot, terminated) {
    if (slot.dead) return;
    if (terminated || this.slots.filter((s) => !s.leased).length >= this.size) {
      slot.dead = true;
      this.slots = this.slots.filter((s) => s !== slot);
      slot.worker.terminate();
    } else {
      slot.leased = false;
      this.wire(slot);
    }
    this.schedule();
  }

  destroy() {
    this.destroyed = true;
    for (const job of this.queue) job.resolve({ status: 'cancelled' });
    this.queue = [];
    for (const slot of [...this.slots]) {
      slot.dead = true;
      slot.worker.terminate();
      this.finish(slot, { status: 'cancelled' });
    }
    this.slots = [];
  }
}
