import { logicalLines, splitStatements } from './outline.js';

const OPENERS = [
  { kind: 'Sub', re: /^(?:(?:Public|Private|Friend|Static)\s+)*Sub\s+[A-Za-z_]/i, close: 'End Sub' },
  { kind: 'Function', re: /^(?:(?:Public|Private|Friend|Static)\s+)*Function\s+[A-Za-z_]/i, close: 'End Function' },
  { kind: 'Property', re: /^(?:(?:Public|Private|Friend|Static)\s+)*Property\s+(?:Get|Let|Set)\s+[A-Za-z_]/i, close: 'End Property' },
  { kind: 'Type', re: /^(?:(?:Public|Private)\s+)?Type\s+[A-Za-z_]/i, close: 'End Type' },
  { kind: 'Enum', re: /^(?:(?:Public|Private)\s+)?Enum\s+[A-Za-z_]/i, close: 'End Enum' },
  { kind: 'For', re: /^For\s+/i, close: 'Next' },
  { kind: 'Do', re: /^Do(?:\s|$)/i, close: 'Loop' },
  { kind: 'While', re: /^While\s+/i, close: 'Wend' },
  { kind: 'With', re: /^With\s+/i, close: 'End With' },
  { kind: 'Select', re: /^Select\s+Case\b/i, close: 'End Select' }
];

const CLOSERS = [
  { word: 'End Sub', kind: 'Sub', re: /^End\s+Sub\b/i },
  { word: 'End Function', kind: 'Function', re: /^End\s+Function\b/i },
  { word: 'End Property', kind: 'Property', re: /^End\s+Property\b/i },
  { word: 'End Type', kind: 'Type', re: /^End\s+Type\b/i },
  { word: 'End Enum', kind: 'Enum', re: /^End\s+Enum\b/i },
  { word: 'End If', kind: 'If', re: /^End\s+If\b/i },
  { word: 'End With', kind: 'With', re: /^End\s+With\b/i },
  { word: 'End Select', kind: 'Select', re: /^End\s+Select\b/i },
  { word: 'Next', kind: 'For', re: /^Next(?:\s|$)/i },
  { word: 'Loop', kind: 'Do', re: /^Loop(?:\s|$)/i },
  { word: 'Wend', kind: 'While', re: /^Wend\b/i }
];

const DECLARE = /^(?:(?:Public|Private)\s+)?Declare\s/i;
const BLOCK_IF = /^If\b.*\bThen\s*$/i;
const ANY_IF = /^If\b/i;
const EXIT = /^Exit\s+(Sub|Function|Property)\b/i;
const PROC = /^(?:(?:Public|Private|Friend|Static)\s+)*(Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_]\w*)/i;

function nextCount(stmt) {
  const rest = stmt.replace(/^Next\b/i, '').trim();
  if (!rest) return 1;
  return rest.split(',').filter((x) => x.trim()).length || 1;
}

export function structureProblems(visibleText) {
  const { lines } = logicalLines(visibleText);
  const problems = [];
  const stack = [];
  const procs = new Map();
  let current = null;
  const report = (code, line, col, args) => problems.push({ code, line, col, args });
  const close = (closer, line, col) => {
    let at = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === closer.kind) {
        at = i;
        break;
      }
    }
    if (at < 0) {
      report('vba.structure', line, col, { kind: 'stray', found: closer.word, foundLine: line });
      return;
    }
    if (at !== stack.length - 1) {
      const top = stack[stack.length - 1];
      report('vba.structure', top.line, top.col, { kind: 'mismatch', open: top.kind, openLine: top.line, found: closer.word, foundLine: line });
    }
    if (['Sub', 'Function', 'Property', 'Type', 'Enum'].includes(closer.kind)) stack.length = at;
    else stack.splice(at, 1);
    if (['Sub', 'Function', 'Property'].includes(closer.kind)) current = null;
  };
  for (const L of lines) {
    const stmts = splitStatements(L.text);
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      if (DECLARE.test(stmt)) break;
      const closer = CLOSERS.find((c) => c.re.test(stmt));
      if (closer) {
        if (closer.kind === 'For') {
          const n = nextCount(stmt);
          for (let k = 0; k < n; k++) close(closer, L.line, L.col);
        } else close(closer, L.line, L.col);
        continue;
      }
      const ex = EXIT.exec(stmt);
      if (ex) {
        const want = ex[1].toLowerCase();
        if (current && current.kind !== want) report('vba.exit', L.line, L.col, { exit: `Exit ${ex[1]}`, inside: current.kind, insideLine: current.line });
        continue;
      }
      if (ANY_IF.test(stmt)) {
        if (BLOCK_IF.test(stmt) && i === stmts.length - 1) stack.push({ kind: 'If', line: L.line, col: L.col });
        break;
      }
      const opener = OPENERS.find((o) => o.re.test(stmt));
      if (!opener) continue;
      if (opener.kind === 'For' && /^For\s+Each\b/i.test(stmt)) {
        stack.push({ kind: 'For', line: L.line, col: L.col });
        continue;
      }
      stack.push({ kind: opener.kind, line: L.line, col: L.col });
      const pm = PROC.exec(stmt);
      if (pm) {
        const kind = pm[1].toLowerCase().replace(/\s+/g, '-');
        const key = `${kind}:${pm[2].toLowerCase()}`;
        if (procs.has(key)) report('vba.duplicate', L.line, L.col, { name: pm[2], firstLine: procs.get(key) });
        else procs.set(key, L.line);
        current = { kind: pm[1].split(/\s/)[0].toLowerCase(), line: L.line };
      }
    }
  }
  const last = lines.length ? lines[lines.length - 1].endLine : 0;
  for (const b of stack) report('vba.structure', b.line, b.col, { kind: 'unclosed', open: b.kind, openLine: b.line, foundLine: last });
  return problems.sort((a, b) => a.line - b.line || a.col - b.col);
}
