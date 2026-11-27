# Notes: writer lane

## Changed

- `30e7599` F2-03: `ChangeSet.queries.connect` writes the connection-only element for an added query. Files: `src/core/pq/members.js`, `tests/unit/batch-pq-members.test.js`. Opt-in; default behaviour unchanged.
- Ownership row for `writer` added to `docs/fable/ownership.json` (integrator file). Revert it if the integrator disagrees.
- The patch `docs/fable/handover/writer-connection-wip.patch` is now in the tree as `30e7599`. The file is left in place, not deleted.

## Proved

- The failing escaping test had the wrong expectation. `escapeAttr` leaves `>` as it is, which is valid XML; the code was right. The test now checks the raw written text and the parsed values.
- Raw text is checked because the XML reader accepts a bare `&` and a bare `<` in an attribute, so a parse-only test cannot see a missing escape.
- Mutations, each run against `batch-pq-members.test.js`: name attribute unescaped (2 fail), description unescaped (2), command unescaped (2), connection string unescaped (8). All caught. The two that survived before are dead.
- Names with `;`, `"`, `]` or `=` are refused for a connection, so `Location=` needs no quoting.
- Lint 0 findings. Unit 1752 tests, 1747 pass, 0 fail, 5 skipped.

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

## To the integrator: one more pack case (owns `scripts/make-excel-pack.mjs`)

This is what lets the user check the `connect` element in real Excel, and so decide whether it ever becomes the default. The case is the last one, number 21, so cases 1 to 20 keep their numbers (the user opened part 1 by those numbers). Checked in a scratch copy: `excel-pack.test.js` and `excel-pack-claims.test.js` give 22 passed, 0 failed with the new counts, and `--only=writer-added` still builds. The output opens in `openWorkbook` with `Added` carrying `Query - Added` and no warnings.

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

HAND BACK 30e7599
