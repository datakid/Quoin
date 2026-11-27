# Notes: writer lane

## Queue

| item | commit | verified |
|---|---|---|
| 1 merge `origin/fable`, run the ownership check | `8189766` | `check-ownership map` ok; `lane writer origin/fable` lists only `src/batch/execute/index.js` and `tests/unit/batch-execute.test.js`, both accepted by the integrator |
| 2 split `module-excel-made` into three cases | `135fbe5` | pack tests 23 pass; lint 0; 22 cases, 27 outputs; the later cases move up by two |
| 3 check audit of `src/core/pq/**` and `src/core/vba/**` | `4e69548`, `41248a6`, `0062158` | table below; unit 1779 tests, 1774 pass, 0 fail, 5 skipped; lint 0 |
| 4 corpus gap check | not started | |
| 5 one-page Excel README | not started | |
| 6 review of the safety lane | not started | |
| 7 final hand-back | not started | |

## Item 3: every check, and the test that fails when it is off

Method: each refusal, error code and anomaly in the two directories was disabled once in a scratch copy of the repo (the condition replaced by `false && (condition)`, or the anomaly push removed), and the tests that could reach it were run. 76 sites were found. 72 are checks; the other 4 (`dir-stream.js` 31 and 49, `vba-project.js` 21 and 80) only declare, copy or return the anomaly list.

- Before: 19 of the 65 checks that could be disabled mechanically had a test that failed. 46 had none, because 22 reader checks and 8 decompressor checks share a handful of codes and the tests only asserted the code, so another check of the same code fired in its place. Of the 7 checks disabled by hand, the four `refused.*` codes were already pinned; `vba.dir` at `vba-project.js:18` and the `writable` flag were not.
- Now: every check below is caught by a test that asserts the code and the message. The new tests are in `tests/unit/batch-writer-checks.test.js` and `tests/unit/batch-pq-members.test.js`.
- My first run left half of every `A || B` condition active (precedence) and reported nearly everything as untested. It was found because basic checks such as the compound-file signature survived; the condition is now wrapped whole.

| site | code | check | test that fails when the check is off |
|---|---|---|---|
| `pq/datamashup.js:12` | pq.length | {label} exceeds the buffer | T-PQ-4/5: bad length, trailing bytes and version are reported |
| `pq/datamashup.js:33` | pq.package |  | a package that is not a zip is refused as a package problem, and a package with no section is r |
| `pq/datamashup.js:65` | pq.section | Formulas/Section1.m is missing | a package that is not a zip is refused as a package problem, and a package with no section is r |
| `pq/members.js:51` | pq.format | no readable query data | F2-03: a workbook with no query data cannot take an add |
| `pq/members.js:52` | pq.format |  | T-SEC-3: a DataMashup with trailing bytes opens for reading but cannot be written |
| `pq/members.js:53` | pq.format | section did not split cleanly | F2-03: query data that does not split cleanly, or has no item list or connections end, is refus |
| `pq/members.js:54` | pq.format | metadata does not match the section | F2-03: a workbook whose metadata already does not match its section cannot take an add |
| `pq/members.js:105` | pq.format | metadata has no item list | F2-03: query data that does not split cleanly, or has no item list or connections end, is refus |
| `pq/members.js:121` | pq.format | no connections part | F2-03: names that cannot sit in a connection string, a connect for a query that is not being ad |
| `pq/members.js:136` | pq.format | connections part has no end | F2-03: query data that does not split cleanly, or has no item list or connections end, is refus |
| `pq/members.js:176` | refused.loaded | removal refused: query loads or has a connection | F2-03: a query added with a connection cannot be removed, because it now has a connection |
| `pq/members.js:176` | refused.usedBy | removal refused: other queries use it | F2-04: a query that other queries use cannot be removed, and the user can be named |
| `pq/members.js:177` | refused.renameLoaded | rename refused: query loads or has a connection | F2-05: a query that loads to a table or has a connection cannot be renamed |
| `pq/members.js:177` | refused.referenced | rename refused: other queries use it | F2-05: a query that other queries use cannot be renamed and the users are named |
| `pq/members.js:181` | pq.unknown |  | F2-04: removing a name the file does not have fails with pq.unknown, and remove with replace on |
| `pq/members.js:190` | pq.unknown |  | F2-05: names that clash, cannot be written, or do not change are refused before anything is wri |
| `pq/members.js:298` | m.parse | {problem.message} Line {problem.line}, column {problem.col}. | F2-03: text that does not parse is refused with m.parse and nothing is written |
| `pq/writeback.js:8` | pq.unknown |  | unknown query edits are rejected |
| `vba/cfb-read.js:23` | cfb.header | signature mismatch | readCfb names the header check that refused a file |
| `vba/cfb-read.js:26` | cfb.header | byte order | readCfb names the header check that refused a file |
| `vba/cfb-read.js:29` | cfb.header | version or sector size | readCfb names the header check that refused a file |
| `vba/cfb-read.js:30` | cfb.header | mini sector size | readCfb names the header check that refused a file |
| `vba/cfb-read.js:35` | limit.cfb | too many sectors | readCfb refuses a file with too many sectors, and a header that claims too many FAT sectors |
| `vba/cfb-read.js:39` | cfb.range | sector {n} is out of range | readCfb refuses a DIFAT chain that loops and a sector number past the end of the file |
| `vba/cfb-read.js:48` | limit.cfb | too many FAT sectors | readCfb refuses a file with too many sectors, and a header that claims too many FAT sectors |
| `vba/cfb-read.js:59` | cfb.loop | DIFAT chain loops | readCfb refuses a DIFAT chain that loops and a sector number past the end of the file |
| `vba/cfb-read.js:83` | cfb.chain | chain hits a special sector | readCfb names what is wrong with a FAT chain |
| `vba/cfb-read.js:84` | cfb.loop | FAT chain loops | readCfb names what is wrong with a FAT chain |
| `vba/cfb-read.js:86` | cfb.range | FAT index out of range | readCfb names what is wrong with a FAT chain |
| `vba/cfb-read.js:101` | cfb.short | stream shorter than its declared size | readCfb names what is wrong with a FAT chain |
| `vba/cfb-read.js:128` | cfb.root | root entry missing | readCfb refuses a directory with no root entry, an object of an unknown type, and a tree that l |
| `vba/cfb-read.js:149` | cfb.loop | MiniFAT chain loops | readCfb names what is wrong with a chain in the mini stream |
| `vba/cfb-read.js:150` | cfb.range | mini sector out of range | readCfb names what is wrong with a chain in the mini stream |
| `vba/cfb-read.js:152` | cfb.loop | mini chain longer than the stream | readCfb names what is wrong with a chain in the mini stream |
| `vba/cfb-read.js:157` | cfb.short | mini stream shorter than its declared size | readCfb names what is wrong with a chain in the mini stream |
| `vba/cfb-read.js:166` | cfb.range | directory id out of range | readCfb refuses a directory with no root entry, an object of an unknown type, and a tree that l |
| `vba/cfb-read.js:167` | cfb.loop | directory tree loops | readCfb refuses a directory with no root entry, an object of an unknown type, and a tree that l |
| `vba/cfb-read.js:191` | cfb.type | unexpected object type | readCfb refuses a directory with no root entry, an object of an unknown type, and a tree that l |
| `vba/cfb-write.js:186` | cfb.write | entry name too long | writeCfb refuses an entry name longer than 31 characters and accepts 31 |
| `vba/codepages.js:81` | vba.codepage | code page {cp} is not supported | encodeText refuses a code page it does not know and a character the page cannot hold |
| `vba/codepages.js:93` | vba.codepage | character {ch} cannot be saved in code page {cp} | encodeText refuses a code page it does not know and a character the page cannot hold |
| `vba/codepages.js:106` | vba.codepage | character {ch} cannot be saved in code page {cp} | T-VBA-CP-1/2: code page encoders reject unmappable text and honour DBCS rules |
| `vba/dir-stream.js:40` | anomaly | dir.truncated | parseDir reports each way a dir stream can be damaged, and nothing for a sound one |
| `vba/dir-stream.js:47` | anomaly | dir.trailing | parseDir reports each way a dir stream can be damaged, and nothing for a sound one |
| `vba/dir-stream.js:48` | anomaly | dir.terminator | parseDir reports each way a dir stream can be damaged, and nothing for a sound one |
| `vba/ovba-decompress.js:11` | ovba.signature | container signature byte is not 0x01 | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:16` | ovba.chunk | truncated chunk header | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:18` | ovba.chunk | invalid chunk signature | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:22` | ovba.chunk | chunk overruns the container | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:35` | ovba.chunk | chunk exceeds 4096 bytes | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:38` | ovba.chunk | truncated copy token | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:41` | ovba.offset | copy token at the start of a chunk | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:46` | ovba.offset | copy offset precedes the chunk | decompress names the check that refused each hostile container |
| `vba/ovba-decompress.js:47` | ovba.chunk | copy runs past the chunk | decompress names the check that refused each hostile container |
| `vba/vba-project.js:13` | vba.dir | the VBA/dir stream is missing | a project with no VBA/dir stream is refused, and one with no PROJECT stream is flagged |
| `vba/vba-project.js:18` | vba.dir | dir stream cannot be decompressed | a VBA/dir stream that cannot be decompressed is reported as a dir problem |
| `vba/vba-project.js:28` | anomaly | vba.projectStream | a project with no VBA/dir stream is refused, and one with no PROJECT stream is flagged |
| `vba/vba-project.js:67` | anomaly | vba.moduleCount | F2-07: selfCheck rejects an output whose module records do not match its module list |
| `vba/vba-project.js:68` | (writable flag) | an anomaly makes a project not writable | a project whose dir stream has trailing bytes can be read but is not writable |
| `vba/writeback.js:116` | vba.write | module records do not match the module list | writeVbaProject names what is wrong with an edit |
| `vba/writeback.js:138` | vba.write | this project cannot be written | F2-07: a project that cannot be written cannot take an add or a remove |
| `vba/writeback.js:148` | vba.write | module {name} cannot be removed: {problem} | F2-07: only standard and class modules can be removed; sheets and the workbook cannot, and unkn |
| `vba/writeback.js:149` | vba.write | module {name} is both edited and removed | F2-07: only standard and class modules can be removed; sheets and the workbook cannot, and unkn |
| `vba/writeback.js:153` | vba.write | unknown module {name} | writeVbaProject names what is wrong with an edit |
| `vba/writeback.js:161` | vba.write | module {name} cannot be added: {problem} | F2-07: names VBA would not accept, names already in use and names that clash with a stream are  |
| `vba/writeback.js:162` | vba.write | module {name} is added twice | F2-07: two adds that differ only by case, or an add of a module that is also removed, are refus |
| `vba/writeback.js:220` | check.vba | module missing after write | verifyVbaProject names a module that is missing or whose text changed |
| `vba/writeback.js:221` | check.vba | module text changed during write | verifyVbaProject names a module that is missing or whose text changed |

### No test, because no input reaches the check

- `vba/cfb-read.js:89` chain longer than the FAT: the loop check (line 84) and the FAT index check (line 86) fire first. More distinct sectors than the FAT has entries cannot exist.
- `vba/cfb-write.js:142`: sector accounting inside the writer; only a bug in the writer trips it.
- `vba/writeback.js:143`: self-check that a compressed module decompresses to its text; only a bug in the compressor trips it.
- `vba/writeback.js:207`: an added module stream missing after it was inserted; only a bug in the writer trips it.

## Earlier work

## Changed

- `30e7599` F2-03: `ChangeSet.queries.connect` writes the connection-only element for an added query. Files: `src/core/pq/members.js`, `tests/unit/batch-pq-members.test.js`. Opt-in; default behaviour unchanged.
- Ownership row for `writer` added to `docs/fable/ownership.json` (integrator file). Revert it if the integrator disagrees.
- The patch `docs/fable/handover/writer-connection-wip.patch` is now in the tree as `30e7599`. The file is left in place, not deleted.

## Proved

- The failing escaping test had the wrong expectation. `escapeAttr` leaves `>` as it is, which is valid XML; the code was right. The test now checks the raw written text and the parsed values.
- Raw text is checked because the XML reader accepts a bare `&` and a bare `<` in an attribute, so a parse-only test cannot see a missing escape.
- Mutations, each run against `batch-pq-members.test.js`: name attribute unescaped (2 fail), description unescaped (2), command unescaped (2), connection string unescaped (8). All caught. The two that survived before are dead.
- Names with `;`, `"`, `]` or `=` are refused for a connection, so `Location=` needs no quoting.
- Lint 0 findings. Unit 1759 tests, 1754 pass, 0 fail, 5 skipped.

## Mutation testing of the writer files (2026-11-27)

One operator changed at a time (`===`, `!==`, `&&`, `||`, comparisons, `true`, `false`) in `members.js`, `writeback.js` and `changes.js`: 139 mutants. Run against the `batch-*`, `plan-run`, `dirty`, `excel-pack*` and `save*` tests, 120 were caught and 19 survived (86%).

- 12 survivors were in `writeQueryEdits` and its copy of `wrapBase64`, which nothing has called since `save.js` moved to `writeQueryChanges`. Deleted in its own commit; `changedQueryEdits` stays.
- 7 survivors were real gaps and are now caught by new tests: wrapped base64 width, the no-mashup guard of `queryReferencers`, the refresh-on-open default and its three forms, the no-rewrite case of a connection that already refreshes, the `verified` and `signature_removed` defaults of a report row, the default of `acknowledgeSignature` in `planChanges`, and the hash an add refused for an existing name reports. Each test was run against its own mutant and fails on it.
- 4 survivors are left. `members.js` line 212 (two `||`): the item is skipped one line later anyway, so the result is the same. Line 262: a section text with no line break at all does not occur in a real file. Line 319: with nothing flagged the block changes nothing.
- The new tests for `changes.js` are in `tests/unit/batch-writer-changes.test.js`. The file is added to the writer row in `ownership.json` (integrator file; revert if you disagree).

## Cross-checks done for other lanes (2026-11-27)

Writer edits none of these files. Each result below was produced in a scratch copy and thrown away; the exact change is given for the owner.

- Scope's status line asks Writer to update `repro-sheet-gap.mjs` to pass `texts` and `insertions`. That was done earlier (`7f7b76e`). Run against `fable-scope` at `34628de`, all nine tampered outputs are rejected: "every tampered output was rejected: the gap is closed". Nothing to do.
- Finding 5 is NOT fixed on `fable-scope` `34628de`. Adding one sheet, or two, to `tests/fixtures/external/xw_macro04.xlsm` (its `styles.xml` has no `<numFmts>`) fails with `write.selfcheck: check.part xl/styles.xml`. Scope's 101 sheet and transform tests all pass, because none of them uses a workbook without `<numFmts>`.
- Cause: `onlyInsertions` strips `count="…"` from the output before it removes the declared fragments. An inserted `<numFmts count="1">` fragment then no longer matches the text in the output.
- The fix below compares counts only at the end, after the fragments are removed. With it the three tests below pass; without it all three fail. The nine tampers are still all rejected, including the change of only a count (the declared-text check catches it). Scope's 101 tests still pass.

## To the safety lane (owns `src/core/save.js`, `tests/unit/sheet-*.test.js`)

Apply to `src/core/save.js`:

```diff
diff --git a/src/core/save.js b/src/core/save.js
index fdf7768..37000e0 100644
--- a/src/core/save.js
+++ b/src/core/save.js
@@ -123,15 +123,15 @@ function withoutCounts(text, elements) {
   return elements.length ? text.replace(new RegExp(`(<(?:${elements.join('|')})\\b[^>]*?)\\s+count="\\d+"`, 'g'), '$1') : text;
 }
 
-function removable(text, fragments, original) {
-  if (!fragments.length) return text === original;
+function removable(text, fragments, original, counts) {
+  if (!fragments.length) return counts(text) === counts(original);
   const [first, ...rest] = fragments;
-  for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) if (removable(text.slice(0, at) + text.slice(at + first.length), rest, original)) return true;
+  for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) if (removable(text.slice(0, at) + text.slice(at + first.length), rest, original, counts)) return true;
   return false;
 }
 
 function onlyInsertions(original, output, { fragments, countElements }) {
-  return removable(withoutCounts(output, countElements), fragments, withoutCounts(original, countElements));
+  return removable(output, fragments, original, (t) => withoutCounts(t, countElements));
 }
 
 export async function selfCheck(wb, bytes, { changes, touched, addedParts, removedParts, signatureRemoved, partTexts = new Map(), insertions = new Map() }) {
```

Add `tests/unit/sheet-nonumfmts.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkbook } from '../../src/core/workbook.js';
import { applyChangeSet, emptyChangeSet } from '../../src/core/save.js';
import { runOnce } from '../../src/core/m/engine.js';
import { fixture } from './helpers.js';

const NOW = new Date('2026-11-14T10:00:00Z');
const table = runOnce({ sectionText: 'section Section1;\r\n\r\nshared Result =\r\n#table({"Name", "Score"}, {{"Ann", 1}, {"Bob", 2.5}});', queryName: 'Result', now: '2026-11-14T10:00:00.000Z', previewRows: 1 }).value;

async function add(names) {
  const wb = await openWorkbook(fixture('xw_macro04.xlsm'), 'xw_macro04.xlsm');
  assert.ok(!/<numFmts\b/.test((await wb.pkg.text('xl/styles.xml')).text));
  const cs = emptyChangeSet();
  for (const name of names) cs.sheets.add.push({ name, table, culture: 'en-US' });
  const out = await applyChangeSet(wb, cs, { now: NOW });
  return { before: wb, back: await openWorkbook(out.bytes, 'out.xlsm') };
}

test('a sheet can be added to a workbook whose styles part has no numFmts element', async () => {
  const { before, back } = await add(['Clean']);
  assert.deepEqual(back.sheets.map((s) => s.name), [...before.sheets.map((s) => s.name), 'Clean']);
});

test('two sheets can be added to a workbook whose styles part has no numFmts element', async () => {
  const { before, back } = await add(['Clean', 'Clean 2']);
  assert.deepEqual(back.sheets.map((s) => s.name), [...before.sheets.map((s) => s.name), 'Clean', 'Clean 2']);
});

test('the macro project of the workbook is unchanged after a sheet is added', async () => {
  const { before, back } = await add(['Clean']);
  const name = [...before.pkg.zip.entries.map((e) => e.name)].find((n) => /vbaProject\.bin$/.test(n));
  assert.ok(name);
  const a = await before.pkg.bytes(name);
  const b = await back.pkg.bytes(name);
  assert.deepEqual(Buffer.from(b), Buffer.from(a));
});
```

## One more pack case, for the integrator's word

`scripts/make-excel-pack.mjs` is in the writer row since `cb02733`, so I can apply this, but it adds a case to the user's one sitting in Excel, so it waits for the integrator. It would go last, so no existing case changes number: it would be case 23 after the split in item 2, and the counts in `excel-pack.test.js` would become 23 cases and 28 outputs. The diff below was made before the split and needs those counts and context lines redone.

This is what lets the user check the `connect` element in real Excel, and so decide whether it ever becomes the default. Checked in a scratch copy: `excel-pack.test.js` and `excel-pack-claims.test.js` give 22 passed, 0 failed with the new counts, and `--only=writer-added` still builds. The output opens in `openWorkbook` with `Added` carrying `Query - Added` and no warnings.

```diff
diff --git a/scripts/make-excel-pack.mjs b/scripts/make-excel-pack.mjs
index 5604bd2..9e5f813 100644
--- a/scripts/make-excel-pack.mjs
+++ b/scripts/make-excel-pack.mjs
@@ -320,6 +320,22 @@ async function build() {
       'Debug > Compile VBAProject gives no error and the macros still run.'
     ]
   });
+
+  const connectBook = await openWorkbook(simple, 'pq_simple.xlsx');
+  const connectChanges = emptyChangeSet();
+  connectChanges.queries.add.set('Added', ADDED_M);
+  connectChanges.queries.connect = new Set(['Added']);
+  const connectOut = await applyChangeSet(connectBook, connectChanges, { now: CLOCK });
+  add({
+    slug: 'query-add-connection', title: 'Add a query together with its connection', input: ['pq_simple.xlsx', simple], outputs: [['output.xlsx', connectOut.bytes]],
+    look: [
+      'The output opens with no repair or recovery message.',
+      'Data > Queries & Connections lists Added next to StudentResults, and the Connections tab lists \"Query - Added\".',
+      'Right-click Added > Edit. The query is a #table with one column Pack and one row \"added by Quoin\".',
+      'Data > Refresh All finishes with no error and StudentResults still shows its table.',
+      'Save the output from Excel under another name and open the copy: it opens with no message and Added is still listed.'
+    ]
+  });
 }
 
 const pad = (n) => String(n).padStart(2, '0');
@@ -351,7 +367,7 @@ function checklist(sums) {
   return lines.join('\n');
 }
 
-export const WRITER_ADDED = ['query-replace-refresh', 'query-add-awkward-names', 'module-excel-made', 'signed-add-remove', 'module-locked-project', 'new-sheet-macro-workbook', 'new-sheet-signed-workbook'];
+export const WRITER_ADDED = ['query-replace-refresh', 'query-add-awkward-names', 'module-excel-made', 'signed-add-remove', 'module-locked-project', 'new-sheet-macro-workbook', 'new-sheet-signed-workbook', 'query-add-connection'];
 
 export async function makePack({ only = null } = {}) {
   cases.length = 0;
diff --git a/tests/unit/excel-pack.test.js b/tests/unit/excel-pack.test.js
index 2833207..1dbae4b 100644
--- a/tests/unit/excel-pack.test.js
+++ b/tests/unit/excel-pack.test.js
@@ -28,10 +28,10 @@ const built = async () => {
 
 test('the pack has a checklist first and an input and an output folder for every case', async () => {
   const { made, files } = await built();
-  assert.equal(made.cases, 20);
+  assert.equal(made.cases, 21);
   assert.equal(files.has('CHECKLIST.md'), true);
   const folders = new Set([...files.keys()].filter((n) => n.startsWith('cases/')).map((n) => n.split('/')[1]));
-  assert.equal(folders.size, 20);
+  assert.equal(folders.size, 21);
   for (const f of folders) {
     assert.ok([...files.keys()].some((n) => n.startsWith(`cases/${f}/input/`)), f);
     const manual = [...files.keys()].some((n) => n.startsWith(`cases/${f}/recipe/`)) && ![...files.keys()].some((n) => n.startsWith(`cases/${f}/output/`));
@@ -43,7 +43,7 @@ test('every output opens with Quoin and appears in the checklist with its SHA-25
   const { files } = await built();
   const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
   const outputs = [...files.keys()].filter((n) => n.includes('/output/'));
-  assert.equal(outputs.length, 27);
+  assert.equal(outputs.length, 28);
   for (const name of outputs) {
     const wb = await openWorkbook(files.get(name), name.split('/').pop());
     assert.ok(wb.sheets.length > 0, name);
@@ -54,9 +54,9 @@ test('every output opens with Quoin and appears in the checklist with its SHA-25
 test('the checklist lists every case, marks nothing as verified, and tells the person how to report', async () => {
   const { files } = await built();
   const list = new TextDecoder().decode(files.get('CHECKLIST.md'));
-  assert.equal((list.match(/^## \d\d /gm) || []).length, 20);
-  assert.equal((list.match(/^- \[ \] pass$/gm) || []).length, 20);
-  assert.equal((list.match(/^- \[ \] fail\./gm) || []).length, 20);
+  assert.equal((list.match(/^## \d\d /gm) || []).length, 21);
+  assert.equal((list.match(/^- \[ \] pass$/gm) || []).length, 21);
+  assert.equal((list.match(/^- \[ \] fail\./gm) || []).length, 21);
   assert.equal(/\[x\]/i.test(list), false);
   assert.match(list, /Nothing here is marked verified until you say so\./);
   assert.match(list, /repair or recovery message on opening is a fail/);
```

## Open

- No Excel check of the new element yet. Case 21 above is the check: opens without repair, appears in Queries and Connections and on the Connections tab, editor preview, Refresh All, Save As and reopen.
- `executeFile` does not set `queries.connect`. A recipe field touches `src/batch/recipe/**` and `src/batch/resolve/**`, which writer does not own.
- Keep `connect` opt-in until the case 02 result is in.

## Need from other owners

- Integrator: add pack case 21; decide whether to wire a recipe field for `connect`, and whether `OWNERSHIP.md` should list the writer row as given.
- Safety lane: apply the `save.js` fix and add the test above; Finding 5 is the one open defect that stops a sheet from being added to an XlsxWriter workbook.
- The `Claude-Session` trailer is left off these commits; this session has no session URL.

HAND BACK 0062158
