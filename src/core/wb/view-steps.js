import { generateStep } from './m-gen.js';
import { insertStepAfter } from './let-edit.js';
import { isViewEmpty } from './view-ops.js';

export function viewActions(view) {
  const actions = [];
  for (const f of (view && view.filters) || []) actions.push({ type: 'filter', ...f });
  if (view && view.hidden && view.hidden.length) actions.push({ type: 'removeColumns', columns: view.hidden.slice() });
  return actions;
}

export function insertViewSteps(text, index, view, { prevName, existing, names }) {
  if (isViewEmpty(view)) return { ok: false, reason: 'There is no view to add.' };
  const taken = existing.slice();
  let prev = prevName;
  let at = index;
  let out = text;
  const added = [];
  for (const action of viewActions(view)) {
    let step;
    try {
      step = generateStep(action, { prev, existing: taken, names });
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
    const res = insertStepAfter(out, at, step.name, step.expr, { rewire: true });
    if (!res.ok) return { ok: false, reason: res.reason };
    out = res.text;
    taken.push(step.name);
    added.push(step.name);
    prev = step.name;
    at += 1;
  }
  return { ok: true, text: out, added };
}
