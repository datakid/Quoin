import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { M_NAMES } from './m-names.js';
import { completionContext, completionItems, shouldAutoComplete, signatureAt, nameAt, definitionAt, referencesIn, signatureText } from '../../core/wb/editor-intel.js';

export const NAME_ROWS = new Map(M_NAMES.map((r) => [r[0], r]));

let uid = 0;

function labelNodes(item) {
  const out = [];
  const label = item.label;
  let at = 0;
  for (const [s, e] of item.ranges || []) {
    if (s > at) out.push(label.slice(at, s));
    out.push(h('span', { class: 'cmp-hit' }, label.slice(s, e)));
    at = e;
  }
  if (at < label.length) out.push(label.slice(at));
  return out;
}

export class Intel {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.id = ++uid;
    this.items = [];
    this.index = 0;
    this.ctx = null;
    this.popup = null;
    this.tip = null;
    this.sigKey = '';
    this.suppress = false;
    this.live = h('div', { class: 'sr-only intel-live', 'aria-live': 'polite' });
    editor.root.append(this.live);
    const ta = editor.textarea;
    ta.setAttribute('aria-autocomplete', 'list');
    editor.hooks.key = (ev) => this.onKey(ev);
    editor.hooks.input = () => this.onInput();
    editor.hooks.caret = () => this.onCaret();
    editor.hooks.mod = (offset) => this.onModClick(offset);
    editor.hooks.blur = () => this.onBlur();
  }

  restoreCaret() {
    if (!this.lastCaret) return;
    this.editor.textarea.setSelectionRange(this.lastCaret[0], this.lastCaret[1]);
  }

  enabled() {
    return this.host.enabled();
  }

  env() {
    return this.host.env(this.editor.textarea.selectionStart);
  }

  isOpen() {
    return !!this.popup;
  }

  onInput() {
    if (this.suppress || !this.enabled()) return;
    this.trigger(false);
    this.updateSignature();
  }

  onCaret() {
    if (!this.enabled()) return;
    if (this.popup) {
      const ctx = completionContext(this.editor.textarea.value, this.editor.textarea.selectionStart);
      if (!ctx || ctx.kind !== this.ctx.kind || ctx.start !== this.ctx.start) this.close();
    }
    this.updateSignature();
  }

  onBlur() {
    const ta = this.editor.textarea;
    if (document.activeElement !== ta || !this.lastCaret) this.lastCaret = [ta.selectionStart, ta.selectionEnd];
    setTimeout(() => {
      if (document.activeElement !== this.editor.textarea) {
        this.close();
        this.hideTip();
      }
    }, 0);
  }

  onModClick(offset) {
    if (!this.enabled()) return false;
    return this.definitionAtOffset(offset);
  }

  onKey(ev) {
    if (!this.enabled()) return false;
    const mod = ev.ctrlKey || ev.metaKey;
    if (this.popup) {
      if (ev.key === 'ArrowDown' && !mod && !ev.altKey) return this.move(1, ev);
      if (ev.key === 'ArrowUp' && !mod && !ev.altKey) return this.move(-1, ev);
      if ((ev.key === 'Enter' || ev.key === 'Tab') && !mod && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        this.accept(this.index);
        return true;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
        this.live.textContent = S.intel.closed;
        return true;
      }
    }
    if (ev.key === ' ' && ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      this.trigger(true);
      return true;
    }
    if (ev.key === 'F12' && !mod && !ev.altKey) {
      ev.preventDefault();
      if (ev.shiftKey) this.findReferences();
      else this.definitionAtOffset(this.editor.textarea.selectionStart);
      return true;
    }
    if (ev.key === 'F2' && !mod && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      this.rename();
      return true;
    }
    return false;
  }

  trigger(explicit) {
    const text = this.editor.textarea.value;
    const caret = this.editor.textarea.selectionStart;
    const ctx = completionContext(text, caret);
    if (!ctx || (!explicit && !shouldAutoComplete(ctx))) {
      this.close();
      return;
    }
    const items = completionItems(ctx, this.env());
    if (!items.length) {
      this.close();
      if (explicit) this.live.textContent = S.intel.count(0);
      return;
    }
    if (items.length === 1 && items[0].label === ctx.prefix && !explicit) {
      this.close();
      return;
    }
    const sameContext = this.popup && this.ctx && this.ctx.start === ctx.start && this.ctx.kind === ctx.kind;
    this.ctx = ctx;
    this.items = items;
    this.index = sameContext ? Math.min(this.index, items.length - 1) : 0;
    this.render();
    if (!sameContext) this.live.textContent = S.intel.count(items.length);
  }

  render() {
    const ta = this.editor.textarea;
    if (!this.popup) {
      this.list = h('ul', { class: 'cmp-list', role: 'listbox', id: `cmp-list-${this.id}`, 'aria-label': S.intel.listLabel });
      this.popup = h('div', { class: 'completion' }, this.list);
      this.popup.addEventListener('mousedown', (ev) => ev.preventDefault());
      document.body.append(this.popup);
      ta.setAttribute('aria-controls', this.list.id);
    }
    clear(this.list);
    this.items.forEach((item, i) => {
      const li = h('li', { class: i === this.index ? 'cmp-item is-active' : 'cmp-item', role: 'option', id: `cmp-opt-${this.id}-${i}`, 'aria-selected': i === this.index ? 'true' : 'false' },
        h('span', { class: 'cmp-label' }, ...labelNodes(item)),
        h('span', { class: 'cmp-kind' }, S.intel.kinds[item.kind] || item.kind),
        item.detail ? h('span', { class: 'cmp-detail' }, item.detail) : null);
      li.addEventListener('click', () => this.accept(i));
      this.list.append(li);
    });
    ta.setAttribute('aria-activedescendant', `cmp-opt-${this.id}-${this.index}`);
    this.place();
    const active = this.list.children[this.index];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  place() {
    if (!this.popup) return;
    const r = this.editor.caretRect();
    const pop = this.popup;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    const below = r.bottom + 4;
    const room = window.innerHeight - below;
    if (room < pop.offsetHeight && r.top > room) pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 4)}px`;
    else pop.style.top = `${below}px`;
  }

  move(dir, ev) {
    ev.preventDefault();
    this.index = (this.index + dir + this.items.length) % this.items.length;
    this.render();
    return true;
  }

  accept(i) {
    const item = this.items[i];
    const ctx = this.ctx;
    if (!item || !ctx) return;
    const end = this.editor.textarea.selectionStart;
    this.close();
    this.suppress = true;
    this.editor.replaceRange(ctx.start, Math.max(end, ctx.end), item.insert);
    this.suppress = false;
    this.editor.textarea.focus();
    this.updateSignature();
  }

  close() {
    if (!this.popup) return;
    this.popup.remove();
    this.popup = null;
    this.list = null;
    this.items = [];
    this.ctx = null;
    this.editor.textarea.removeAttribute('aria-activedescendant');
    this.editor.textarea.removeAttribute('aria-controls');
  }

  updateSignature() {
    const text = this.editor.textarea.value;
    const caret = this.editor.textarea.selectionStart;
    const sig = signatureAt(text, caret, NAME_ROWS);
    if (!sig) {
      this.hideTip();
      return;
    }
    const key = `${sig.name}:${sig.active}:${sig.over}`;
    if (!this.tip) {
      this.tip = h('div', { class: 'sig-tip', 'aria-hidden': 'true' });
      document.body.append(this.tip);
    }
    clear(this.tip);
    this.tip.append(sig.name, '(');
    sig.params.forEach((p, i) => {
      if (i) this.tip.append(', ');
      const label = p.optional ? `[${p.name}]` : p.name;
      this.tip.append(i === sig.active ? h('strong', { class: 'sig-active' }, label) : label);
    });
    this.tip.append(')');
    const r = this.editor.caretRect();
    this.tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - this.tip.offsetWidth - 8))}px`;
    const above = r.top - this.tip.offsetHeight - 4;
    this.tip.style.top = `${above >= 4 ? above : r.bottom + 4}px`;
    if (key !== this.sigKey) {
      this.sigKey = key;
      const p = sig.params[sig.active];
      this.live.textContent = sig.over ? S.intel.sigOver(sig.name) : S.intel.sigParam(p.name, sig.active + 1, sig.params.length, p.optional);
    }
  }

  hideTip() {
    this.sigKey = '';
    if (this.tip) {
      this.tip.remove();
      this.tip = null;
    }
  }

  definitionAtOffset(offset) {
    const text = this.editor.textarea.value;
    const tok = nameAt(text, offset);
    if (!tok) {
      this.host.note(S.intel.nothingHere);
      return false;
    }
    const def = definitionAt(text, offset, this.env());
    if (!def) {
      this.host.note(S.intel.noDefinition(tok.value));
      return true;
    }
    if (def.kind === 'step') {
      if (def.here) this.host.note(S.intel.isHere(def.name));
      else {
        this.editor.textarea.focus();
        this.editor.textarea.setSelectionRange(def.offset, def.offset);
        this.host.revealOffset(def.offset);
        this.host.note(S.intel.wentToStep(def.name));
      }
    } else if (def.kind === 'query') {
      this.host.openQuery(def.name);
      this.host.note(S.intel.openedQuery(def.name));
    } else if (def.kind === 'function') {
      this.host.note(S.intel.functionInfo(signatureText({ name: def.name, params: def.params }), def.category));
    } else this.host.note(S.intel.constantInfo(def.name, def.category));
    return true;
  }

  findReferences() {
    const text = this.editor.textarea.value;
    const caret = this.editor.textarea.selectionStart;
    const tok = nameAt(text, caret);
    if (!tok) {
      this.host.note(S.intel.nothingHere);
      return;
    }
    const env = this.env();
    const name = tok.value;
    const step = (env.steps || []).find((s) => s.name === name);
    let refs;
    if (step) refs = referencesIn(name, [{ name: env.current, text }], { skipDefinition: { query: env.current, start: step.nameSpan.start } });
    else refs = referencesIn(name, env.docs || []);
    this.host.showReferences({ name, kind: step ? 'step' : 'name', refs });
  }

  rename() {
    const text = this.editor.textarea.value;
    const tok = nameAt(text, this.editor.textarea.selectionStart);
    const env = this.env();
    const step = tok ? (env.steps || []).find((s) => s.name === tok.value) : null;
    if (step) {
      this.host.renameStep(step);
      return;
    }
    if (tok && (env.members || []).includes(tok.value)) this.host.note(S.intel.renameQuery);
    else this.host.note(S.intel.renameNeedsStep);
  }
}
