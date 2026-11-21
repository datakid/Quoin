import { QuoinError } from '../../core/errors.js';

export const MATCH_LIST_LIMIT = 100;
const SIDE_LIMIT = 200;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cut = (text) => (text.length > SIDE_LIMIT ? text.slice(0, SIDE_LIMIT) : text);

function expand(match, input, template) {
  const groups = match.length - 1;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c !== '$' || i === template.length - 1) {
      out += c;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      out += '$';
      i++;
    } else if (next === '&') {
      out += match[0];
      i++;
    } else if (next === '`') {
      out += input.slice(0, match.index);
      i++;
    } else if (next === "'") {
      out += input.slice(match.index + match[0].length);
      i++;
    } else if (next >= '0' && next <= '9') {
      const two = template.slice(i + 1, i + 3);
      if (/^\d\d$/.test(two) && Number(two) >= 1 && Number(two) <= groups) {
        out += match[Number(two)] === undefined ? '' : match[Number(two)];
        i += 2;
      } else if (Number(next) >= 1 && Number(next) <= groups) {
        out += match[Number(next)] === undefined ? '' : match[Number(next)];
        i++;
      } else out += '$';
    } else if (next === '<' && match.groups) {
      const end = template.indexOf('>', i + 2);
      if (end < 0) out += '$';
      else {
        const value = match.groups[template.slice(i + 2, end)];
        out += value === undefined ? '' : value;
        i = end;
      }
    } else out += '$';
  }
  return out;
}

function lineStarts(text) {
  const starts = [0];
  const breaks = /\r\n|\r|\n/g;
  let m;
  while ((m = breaks.exec(text))) starts.push(m.index + m[0].length);
  return starts;
}

export function replaceInText(text, { find, with: replacement, kind, matchCase }, shouldStop = () => false) {
  if (!find) return { text, count: 0, matches: [] };
  if (shouldStop()) throw new QuoinError('m.timeout', 'the deadline passed before the search began');
  const re = new RegExp(kind === 'regex' ? find : escapeRegExp(find), matchCase ? 'g' : 'gi');
  const starts = lineStarts(text);
  const matches = [];
  let out = '';
  let last = 0;
  let count = 0;
  let line = 0;
  for (const m of text.matchAll(re)) {
    if (shouldStop()) throw new QuoinError('m.timeout', 'the deadline passed during the search');
    if (m[0].length === 0) continue;
    const after = kind === 'regex' ? expand(m, text, replacement) : replacement;
    out += text.slice(last, m.index) + after;
    last = m.index + m[0].length;
    count++;
    if (matches.length < MATCH_LIST_LIMIT) {
      while (line + 1 < starts.length && starts[line + 1] <= m.index) line++;
      matches.push({ index: m.index, line: line + 1, col: m.index - starts[line] + 1, before: cut(m[0]), after: cut(after) });
    }
  }
  if (!count) return { text, count: 0, matches: [] };
  return { text: out + text.slice(last), count, matches };
}
