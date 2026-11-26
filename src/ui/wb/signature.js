import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { signatureAt } from '../../core/wb/m-refs.js';

function render(tip, sig) {
  clear(tip);
  const e = sig.entry;
  const parts = [h('span', { class: 'sig-name' }, sig.name), h('span', { class: 'sig-paren' }, '(')];
  e.params.forEach((p, i) => {
    if (i) parts.push(h('span', { class: 'sig-comma' }, ', '));
    const name = typeof p === 'string' ? p : p.name;
    const opt = typeof p === 'string' ? (e.optional || []).includes(name) : p.optional;
    parts.push(h('span', { class: `sig-param${i === sig.current ? ' is-current' : ''}` }, opt ? `${name}?` : name));
  });
  if (e.variadic) {
    if (e.params.length) parts.push(h('span', { class: 'sig-comma' }, ', '));
    parts.push(h('span', { class: 'sig-param' }, '…'));
  }
  parts.push(h('span', { class: 'sig-paren' }, ')'));
  const note = sig.current >= 0 && e.params[sig.current] ? S.signature.current(sig.current + 1, e.params.length) : S.signature.hint;
  tip.append(h('div', { class: 'sig-line' }, ...parts), h('div', { class: 'sig-note item-meta' }, note));
}

export function attachSignature(editor, provide) {
  const ta = editor.textarea;
  const tip = h('div', { class: 'signature', 'aria-live': 'polite', hidden: true });
  document.body.append(tip);
  let open = false;
  let current = null;
  let pinned = false;

  const close = () => {
    if (!open) return;
    open = false;
    current = null;
    pinned = false;
    tip.hidden = true;
    clear(tip);
  };

  const place = () => {
    const r = editor.caretRect();
    const margin = 8;
    const width = tip.offsetWidth || 320;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    let top = r.top - (tip.offsetHeight || 40) - 4;
    if (top < margin) top = r.top + r.height + 2;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const show = (sig) => {
    current = sig;
    open = true;
    render(tip, sig);
    tip.hidden = false;
    place();
  };

  const refresh = () => {
    const ctx = provide();
    const sig = signatureAt(ta.value, ta.selectionStart, ctx && ctx.library);
    if (open) {
      if (!sig) {
        if (!pinned) close();
        return;
      }
      if (!current || sig.name !== current.name || sig.current !== current.current) show(sig);
      else place();
      return;
    }
    if (sig) show(sig);
  };

  const onInput = (ev) => {
    pinned = false;
    if (open) {
      refresh();
      return;
    }
    if (ev.inputType === 'insertText' && (ev.data === '(' || ev.data === ',')) refresh();
  };

  const onKey = (ev) => {
    if (!open) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      close();
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'Home' || ev.key === 'End' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      close();
    }
  };

  const onCaret = () => {
    if (open) refresh();
  };

  ta.addEventListener('keydown', onKey, true);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keyup', onCaret);
  ta.addEventListener('mouseup', onCaret);
  ta.addEventListener('scroll', () => {
    if (open) place();
  });
  ta.addEventListener('blur', close);

  return {
    close,
    showEntry: (entry) => {
      pinned = true;
      show({ name: entry.name, entry, current: -1 });
    }
  };
}
