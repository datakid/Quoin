export const DISTINCT_CAP = 10000;
export const TOP_COUNT = 5;

const ORDERED = new Set(['date', 'time', 'datetime']);

function kindOf(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'logical';
  return v.k || 'other';
}

function keyOf(kind, v) {
  switch (kind) {
    case 'text':
      return `s:${v}`;
    case 'number':
      return `n:${typeof v === 'number' ? (Object.is(v, -0) ? '0' : v) : v.special}`;
    case 'logical':
      return `b:${v}`;
    default:
      return `${kind}:${v.text !== undefined ? v.text : ''}`;
  }
}

function textOf(kind, v) {
  switch (kind) {
    case 'text':
      return v;
    case 'number':
      return typeof v === 'number' ? String(v) : v.special;
    case 'logical':
      return v ? 'true' : 'false';
    default:
      return v.text !== undefined ? v.text : kind;
  }
}

export function profileColumn({ count, at, cap = DISTINCT_CAP, top = TOP_COUNT }) {
  let nulls = 0;
  let errors = 0;
  let numbers = 0;
  let sum = 0;
  let min = null;
  let max = null;
  let minText = null;
  let maxText = null;
  let lengthMin = null;
  let lengthMax = null;
  let capped = false;
  const kinds = new Map();
  const seen = new Map();
  for (let r = 0; r < count; r++) {
    const v = at(r);
    const kind = kindOf(v);
    if (kind === 'null') {
      nulls++;
      continue;
    }
    if (kind === 'error') {
      errors++;
      continue;
    }
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
    const key = keyOf(kind, v);
    const entry = seen.get(key);
    if (entry) entry.count++;
    else if (seen.size < cap) seen.set(key, { kind, value: v, count: 1, order: seen.size });
    else capped = true;
    if (kind === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      numbers++;
      sum += v;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    } else if (kind === 'text') {
      if (lengthMin === null || v.length < lengthMin) lengthMin = v.length;
      if (lengthMax === null || v.length > lengthMax) lengthMax = v.length;
    } else if (ORDERED.has(kind)) {
      if (minText === null || v.text < minText) minText = v.text;
      if (maxText === null || v.text > maxText) maxText = v.text;
    }
  }
  const ranked = [...seen.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, top);
  const filled = count - nulls - errors;
  return {
    count,
    nulls,
    errors,
    filled,
    distinct: seen.size,
    distinctCapped: capped,
    min: numbers ? min : null,
    max: numbers ? max : null,
    mean: numbers ? sum / numbers : null,
    earliest: minText,
    latest: maxText,
    lengthMin,
    lengthMax,
    top: ranked.map((e) => ({ kind: e.kind, text: textOf(e.kind, e.value), value: e.value, count: e.count, share: filled ? e.count / filled : 0 })),
    topApproximate: capped,
    kinds: [...kinds.entries()].map(([kind, n]) => ({ kind, count: n })).sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1)),
    mixed: kinds.size > 1
  };
}

export function distinctLabel(profile, format = (n) => String(n)) {
  return profile.distinctCapped ? `${format(profile.distinct)}+` : format(profile.distinct);
}
