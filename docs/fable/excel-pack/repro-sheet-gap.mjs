import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from '../../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet, selfCheck } from '../../../src/core/save.js';
import { runOnce } from '../../../src/core/m/engine.js';
import { addSheetsToPackage } from '../../../src/core/sheet/add-sheets.js';
const NOW = new Date('2026-11-14T10:00:00Z');
const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../tests/fixtures/external/pq_simple.xlsx', import.meta.url))));
const wb = await openWorkbook(bytes, 'pq_simple.xlsx');
const table = runOnce({ sectionText: 'section Section1;\r\n\r\nshared Result =\r\n#table({"Name","Score"},{{"Ann",1}});', queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;
const cs = emptyChangeSet();
cs.sheets.add.push({ name: 'Clean', table, culture: 'en-US' });
const out = await applyChangeSet(wb, cs, { now: NOW });
const back = await openWorkbook(out.bytes, 'out.xlsx');
const before = new Set(wb.pkg.zip.entries.map((e) => e.name));
const added = back.pkg.zip.entries.map((e) => e.name).filter((n) => !before.has(n));
const probe = wb.pkg.clone();
const written = await addSheetsToPackage(wb, probe, cs.sheets.add);
console.log('added parts', [...written.addedParts]);
const expected = () => ({ changes: cs, touched: new Set(written.touched), addedParts: new Set(written.addedParts), removedParts: new Set(), signatureRemoved: false, partTexts: written.texts, insertions: written.insertions });
let accepted = 0;
async function tamper(label, part, fn) {
  const pkg = back.pkg.clone();
  const t = await pkg.text(part);
  const next = fn(t.text);
  if (next === t.text) { console.log(label, '-> tamper did not apply'); return; }
  pkg.setText(part, next, t);
  const bad = await pkg.write({ now: NOW });
  try { await selfCheck(wb, bad, expected()); accepted += 1; console.log(label, '-> ACCEPTED by selfCheck (gap)'); }
  catch (e) { console.log(label, '-> rejected:', e.code, e.part || ''); }
}
await tamper('T0 workbook.xml: one space appended', 'xl/workbook.xml', (x) => x + ' ');
await tamper('T1 workbook.xml: switch to the 1904 date system', 'xl/workbook.xml', (x) => /<workbookPr/.test(x) ? x.replace(/<workbookPr/, '<workbookPr date1904="1"') : x.replace(/<sheets>/, '<workbookPr date1904="1"/><sheets>'));
await tamper('T2 workbook.xml: hide the first existing sheet', 'xl/workbook.xml', (x) => x.replace(/<sheet /, '<sheet state="hidden" '));
await tamper('T3 styles.xml: swap the first two cell formats', 'xl/styles.xml', (x) => { const m = x.match(/<cellXfs[^>]*>(<xf [^>]*?(?:\/>|>.*?<\/xf>))(<xf [^>]*?(?:\/>|>.*?<\/xf>))/s); return m ? x.replace(m[1] + m[2], m[2] + m[1]) : x; });
await tamper('T4 [Content_Types].xml: drop the Override of an existing part', '[Content_Types].xml', (x) => x.replace(/<Override PartName="\/xl\/theme\/theme1.xml"[^>]*\/>/, ''));
await tamper('T5 workbook.xml.rels: drop an existing relationship', 'xl/_rels/workbook.xml.rels', (x) => x.replace(/<Relationship Id="[^"]*" Type="[^"]*\/theme" Target="[^"]*"\/>/, ''));
await tamper('T6 workbook.xml: hide the new sheet that was added', 'xl/workbook.xml', (x) => x.replace(/<sheet name="Clean"/, '<sheet state="hidden" name="Clean"'));
await tamper('T7 workbook.xml: insert an extra defined name next to the new sheet', 'xl/workbook.xml', (x) => x.replace('</sheets>', '</sheets><definedNames><definedName name="Injected">1</definedName></definedNames>'));
await tamper('T8 styles.xml: change only the count of the cell formats', 'xl/styles.xml', (x) => x.replace(/(<cellXfs[^>]*count=")(\d+)/, (m, a, n) => `${a}${Number(n) + 7}`));
console.log(accepted ? `${accepted} tampered outputs were accepted: the gap is open` : 'every tampered output was rejected: the gap is closed');
process.exitCode = accepted ? 1 : 0;
