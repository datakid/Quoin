import { h, clear } from '../dom.js';
import { S } from '../strings.js';
import { completionAt } from '../../core/wb/completion.js';

function marked(text, ranges) {
  if (!ranges || !ranges.length) return [text];
  const out = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push(text.slice(at, s));
    out.push(h('mark', null, text.slice(s, e)));
    at = e;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function attachCompletion(editor, provide) {
  const ta = editor.textarea;
  const id = `ac-${Math.random().toString(36).slice(2, 8)}`;
  const list = h('ul', { class: 'autocomplete', role: 'listbox', id, 'aria-label': S.completion.label, hidden: true });
  const live = h('span', { class: 'sr-only ac-live', 'aria-live': 'polite' });
  document.body.append(list, live);
  ta.setAttribute('aria-autocomplete', 'list');

  let open = false;
  let current = null;
  let items = [];
  let active = 0;

  const optionId = (i) => `${id}-o${i}`;

  const close = () => {
    if (!open) return;
    open = false;
    current = null;
    items = [];
    list.hidden = true;
    clear(list);
    ta.removeAttribute('aria-expanded');
    ta.removeAttribute('aria-activedescendant');
    ta.removeAttribute('aria-controls');
  };

  const kindLabel = (it) => (it.kind === 'library' ? `${S.completion.kind.library}: ${S.completion.libraryKind[it.libraryKind] || S.completion.kind.library}` : S.completion.kind[it.kind] || S.completion.kind.library);
  const noteOf = (it) => (it.status === 'unsupported' ? S.completion.unsupported : it.status === 'partial' ? S.completion.partial : '');

  const mark = () => {
    for (const row of list.children) {
      const on = row.id === optionId(active);
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
    ta.setAttribute('aria-activedescendant', items.length ? optionId(active) : '');
  };

  const accept = (i) => {
    const it = items[i];
    if (!it || !current) {
      close();
      return;
    }
    const caret = current.start + it.insert.length;
    editor.replaceRange(current.start, current.end, it.insert, caret, caret);
    close();
    ta.focus();
  };

  const paint = () => {
    clear(list);
    items.forEach((it, i) => {
      const note = noteOf(it);
      const row = h('li', {
        role: 'option',
        id: optionId(i),
        class: `ac-row${i === active ? ' is-active' : ''}`,
        'aria-selected': String(i === active),
        'aria-label': note ? `${it.label}, ${kindLabel(it)}, ${note}` : `${it.label}, ${kindLabel(it)}`
      },
      h('span', { class: 'ac-text' }, ...marked(it.label, it.ranges)),
      it.detail ? h('span', { class: 'ac-detail item-meta' }, it.detail) : null,
      note ? h('span', { class: 'ac-note item-meta' }, note) : null,
      h('span', { class: 'ac-kind item-meta' }, kindLabel(it)));
      row.addEventListener('mousemove', () => {
        if (active !== i) {
          active = i;
          mark();
        }
      });
      row.addEventListener('pointerdown', (ev) => ev.preventDefault());
      row.addEventListener('click', () => accept(i));
      list.append(row);
    });
    ta.setAttribute('aria-activedescendant', items.length ? optionId(active) : '');
  };

  const place = () => {
    const r = editor.caretRect();
    const width = list.offsetWidth || 320;
    const height = list.offsetHeight || 200;
    const margin = 8;
    let left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    let top = r.top + r.height + 2;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, r.top - height - 2);
    list.style.left = `${left}px`;
    list.style.top = `${top}px`;
  };

  const compute = () => {
    if (ta.readOnly || editor.language !== 'm') return null;
    return completionAt(ta.value, ta.selectionStart, provide());
  };

  const refresh = (forced) => {
    const res = compute();
    if (!res || !res.items.length) {
      if (forced) live.textContent = S.completion.none;
      close();
      return;
    }
    if (open) {
      const keep = current && res.start === current.start;
      current = res;
      items = res.items;
      active = keep ? Math.min(active, items.length - 1) : 0;
      paint();
      place();
      return;
    }
    if (!forced && !res.auto) return;
    current = res;
    items = res.items;
    active = 0;
    open = true;
    list.hidden = false;
    ta.setAttribute('aria-controls', id);
    ta.setAttribute('aria-expanded', 'true');
    paint();
    place();
    live.textContent = S.completion.count(items.length);
  };

  const onKey = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === ' ' && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      refresh(true);
      return;
    }
    if (!open) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (items.length) {
        active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        mark();
      }
    } else if ((ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey) || (ev.key === 'Tab' && !ev.shiftKey)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      accept(active);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      close();
    } else if (ev.key === 'Home' || ev.key === 'End' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || ev.key === 'PageUp' || ev.key === 'PageDown') {
      close();
    }
  };

  const onCaret = () => {
    if (!open || !current) return;
    const at = ta.selectionStart;
    if (at < current.start || at > current.end) close();
  };

  const onInput = (ev) => {
    if (open) {
      refresh(false);
      return;
    }
    if (ev.inputType === 'insertText' && ev.data && ev.data.length === 1) refresh(false);
  };
  ta.addEventListener('keydown', onKey, true);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keyup', onCaret);
  ta.addEventListener('mouseup', onCaret);
  ta.addEventListener('scroll', () => {
    if (open) place();
  });
  ta.addEventListener('blur', close);
  return { close, open: () => refresh(true) };
}
