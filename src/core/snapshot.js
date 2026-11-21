import { listCurrentWorkbookSources, readSource, readUsedGrid } from './cells.js';

export async function buildSnapshot(wb) {
  const sources = [];
  const queryTables = new Set(wb.queries.filter((q) => q.load.kind === 'table').map((q) => `${q.load.sheet}|${q.load.tableName}`));
  for (const s of listCurrentWorkbookSources(wb)) {
    const data = await readSource(wb, s);
    const queryLoaded = s.kind === 'table' && queryTables.has(`${s.table.sheet}|${s.table.displayName}`);
    sources.push({ name: s.name, kind: s.kind, columns: data.columns, rows: data.rows, queryLoaded });
  }
  return { date1904: wb.date1904, sources };
}

export async function buildBindingWorkbook(wb) {
  const items = [];
  for (const sheet of wb.sheets) {
    if (sheet.type !== 'worksheet' || !sheet.part) continue;
    const grid = await readUsedGrid(wb, sheet.name);
    const width = grid.length ? grid[0].length : 0;
    items.push({ name: sheet.name, item: sheet.name, kind: 'Sheet', hidden: sheet.state !== 'visible', columns: Array.from({ length: width }, (_, i) => `Column${i + 1}`), rows: grid });
  }
  for (const s of listCurrentWorkbookSources(wb)) {
    const data = await readSource(wb, s);
    items.push({ name: s.name, item: s.name, kind: s.kind === 'table' ? 'Table' : 'DefinedName', hidden: false, columns: data.columns, rows: data.rows });
  }
  return { items, date1904: wb.date1904 };
}

const unitError = (code, detail) => ({ snapshot: null, error: { code, detail } });

export async function buildUnitSnapshot(wb, unit, { base } = {}) {
  const snapshot = base || (await buildSnapshot(wb));
  if (unit.kind === 'workbook') return { snapshot, error: null };
  if (unit.kind === 'table') return snapshot.sources.some((s) => s.kind === 'table' && s.name === unit.name) ? { snapshot, error: null } : unitError('unit.missing', unit.name);
  if (!wb.sheets.some((s) => s.type === 'worksheet' && s.part && s.name === unit.name)) return unitError('unit.missing', unit.name);
  if (snapshot.sources.some((s) => s.name === unit.name)) return unitError('unit.nameCollision', unit.name);
  const grid = await readUsedGrid(wb, unit.name);
  const width = grid.length ? grid[0].length : 0;
  const source = { name: unit.name, kind: 'sheet', columns: Array.from({ length: width }, (_, i) => `Column${i + 1}`), rows: grid, queryLoaded: false };
  return { snapshot: { ...snapshot, sources: [...snapshot.sources, source] }, error: null };
}
