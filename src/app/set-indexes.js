const refusedShell = (f, code) => ({ id: f.id, name: f.name, relPath: f.relPath, size: f.size, status: 'refused', refused: { code }, format: null, sheets: [], tables: [], queries: [], modules: [], pq: { editable: false, reason: null }, vba: { present: false, signed: false, locked: false, writable: false }, warnings: [] });

const indexOfRecord = (f) => (f.status === 'ready' && f.index ? f.index : refusedShell(f, f.skipReason || 'file.notWorkbook'));

export const indexesOf = (session) => session.list().filter((f) => f.status !== 'pending').map(indexOfRecord);
