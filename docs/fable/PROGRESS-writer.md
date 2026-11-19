# Fable progress: Writer (`fable-writer`)

Branch `fable-writer`, started from `fable` at 56b3974. Owner of `src/core/save.js`, `src/core/vba/**`, `src/core/pq/members.js`, `src/batch/execute/{index,changes,replace,align}.js` and the tests named in `PARALLEL.md`.

Baseline at 56b3974: lint 0 findings; unit 1131 tests, 1126 pass, 5 skipped.

## Interfaces for trunk

### ChangeSet (built by `executeFile`, applied by `applyChangeSet`)

```
ChangeSet = {
  queries: { add: Map<name, text>, replace: Map<name, text>, rename: Map<oldName, newName>, remove: Set<name> },
  modules: { add: Map<name, text>, replace: Map<name, text>, remove: Set<name> },
  sheets:  { add: [], write: [] },
  refreshOnLoad: Set<queryName>,
  acknowledgeSignature: boolean
}
```

- `emptyChangeSet()` returns one with every key present. `applyChangeSet` also accepts a partial object and fills in the rest.
- `replace` keys are the name in the source workbook. A query that is both renamed and replaced is replaced under its old name.
- `replace` texts for queries must already be trimmed (`normalizeQueryText`); `changedQueryEdits` does that for `buildWorkbook`.
- `refreshOnLoad` names are flagged on the query's existing connection even when the global option is off. Names that are not edited, and queries with no connection, are ignored.

### applyChangeSet

`applyChangeSet(wb, changeSet, { now, refreshOnLoad = true, checkSection = null, faultInject = false })` returns `{ bytes, name, queriesChanged, modulesChanged, signatureRemoved }`.

- `now` is a `Date`, as `writeZip` takes it. It reaches the outer package and the inner DataMashup package. Callers that hold an ISO string convert with `zipClock` from `src/batch/execute/collect.js`.
- Without `now` the clock is read at write time, as `buildWorkbook` always did.
- Change kinds that are declared but not built yet (`modules.add`, `modules.remove`, `sheets.*`) throw `TypeError` and write nothing. Query add, rename and remove throw `TypeError` from `members.js` until F2-03, F2-04 and F2-05.

### selfCheck

`selfCheck(wb, bytes, { changes, touched, addedParts, removedParts, signatureRemoved })` is exported from `save.js` so its tampering cases can be tested. It is still defined and called only in `save.js`.

### executeFile

`executeFile(wb, filePlan, { now, recipe, meta, runId })` returns `{ fileId, bytes, sha256, changes, warnings, rows }`.

- `now` is the Plan's ISO UTC string. `recipe` is `plan.recipe`. `meta` is `{ name, relPath }` for the report row and defaults to `wb.fileName`. `runId` fills the `run_id` column.
- `recipe` is an addition to the interface in `PARALLEL.md`. `FilePlan` and `Action` carry no query text, find string or hash, so the recipe has to come with the call.
- Any other option, including `dryRun`, is never read. A test pins that.
- `bytes` and `sha256` are `null` when nothing is written: every action unchanged or skipped, or the file failed.
- `changes` is a list of `Change = { op, target: { type, name }, oldHash, newHash }`. The card did not give the shape.
- One row per action, in action order, with the Appendix B columns. `output` is left empty; the output name is assigned where outputs are named (Appendix C). `reason` is left empty; the text comes from `reason_code`.
- Verdicts from here: `changed` (verified), `unchanged` (nothing written), `skipped` (`skip.notApplicable`), `failed` (a Quoin error such as `m.parse`), `not-released` (`write.selfcheck`). When a write fails, every changed action gets the failure; skipped and unchanged actions keep theirs.
- An error that is not a Quoin error is thrown, as `executeFilePlan` in `collect.js` does, so the worker turns it into a failed row.
- An op that is not built yet throws `Error('<op> <target> is not supported yet')`.
- `REPORT_COLUMNS` and `zipClock` are imported from `collect.js`, which is trunk's file. If trunk moves them, update the two imports in `changes.js` and `index.js`.

## Strings and error codes for trunk

New reason codes (plain data in report rows, not `QuoinError` codes):

| Code | Used for | Suggested text |
|---|---|---|
| `skip.notApplicable` | a replace action whose query is not in the file | listed in Appendix B with no text yet |
| `refused.exists` | an add of a name the file already has (compared without regard to case, and against every section member) | "Not added. The file already has a query named {name}." |
| `refused.name` | an add whose name is empty, has a space at either end or has a control character | "Not added. This name cannot be used." |
| `refused.loaded` | a remove of a query that has a connection or loads to a table or the data model | "Not removed. This query loads to {target}." |
| `refused.usedBy` | a remove of a query that another query uses, or while a query reads `#shared` | "Not removed. Used by {names}." |

For the two `refused.*` codes above, and for later ones that take a parameter, the report row's `reason` column holds only the parameter: the target (`Sheet1!Table1`, `data model`, or `connection Query - Name`) or the user names joined with a comma and a space. The sentence is built from the code in `strings.js`.

`pq.none` and `pq.format` are used as `reason_code` for refused adds (no query data, and query data Quoin does not write). Both are already in `ERRORS`.

Verdict `not-released` carries `write.selfcheck`; verdict `failed` carries the `QuoinError` code (`m.parse` so far). Both codes are already in `ERRORS`.

## Tasks

### F2-01 ChangeSet and generalised selfCheck
Layer: core
Files: src/core/save.js, src/core/pq/members.js (new), tests/unit/batch-save.test.js (new)
Do: `applyChangeSet`; `buildWorkbook` builds a ChangeSet and calls it; `selfCheck` verifies the declared query and module changes, that no undeclared part appears, that no declared part is missing, that declared removals are gone, and that every other part is byte-identical; `now` reaches both zips.
Test that fails without it: `tests/unit/batch-save.test.js`, 28 tests. Without the change the file fails at import: `SyntaxError: The requested module '../../src/core/save.js' does not provide an export named 'applyChangeSet'`.
Fails without, by mutation after the change (each mutation reverted afterwards):
- inner zip ignores `now`: 5 tests fail
- outer zip ignores `now`: 6 tests fail
- extra part not detected: 1 fails
- undeclared query not detected: 2 fail
- per-query refresh flag ignored: 1 fails
- undeclared module not detected: 1 fails
- declared removal check off: 1 fails
- declared add check off: 1 fails
Single-file bytes: six scenarios (query edit with and without refresh, query and module edit, signed module edit, no edit, template query edit) have the SHA-256 of the output recorded from `buildWorkbook` before the change, under a frozen clock and `TZ=UTC`. The same hashes come out after it. The existing T-B-04 and T-B-06 tests pass unchanged.
Result: Done
Changed expectations: none
Deviations:
- The plan lists only `save.js` for this card. `members.js` is also created here because `buildDataMashup` writes the inner package with the real clock, so Preview and Run bytes would differ. `members.js` builds the inner package itself with `now`. It repeats `wrapBase64` and the DataMashup assembly from `writeback.js` and `datamashup.js`, which are trunk files and are not edited. After the merge trunk can retire `writeQueryEdits` and `buildDataMashup` if nothing else calls them.
- `selfCheck` is exported. T-LINT-12 still passes.
- The connection part is now counted as touched only when it was actually edited. The output bytes are the same.
Decisions inside gaps:
- The check that the write adds no new `pq.*` warning belongs with F2-03, where a mismatch can be produced to test it. It is not in F2-01.
Counts after this task: lint 0 findings; unit 1159 tests, 1154 pass, 5 skipped.

### F2-02 Execute: replace a query
Layer: batch/execute
Files: src/batch/execute/index.js (new), src/batch/execute/changes.js (new), tests/lint/checks.js (T-LINT-21 only), tests/unit/batch-execute.test.js (new), tests/unit/lint-rules-writer.test.js (new)
Do: `executeFile` turns replace-query actions into a ChangeSet (`planChanges`), calls `applyChangeSet` once, and builds the result and rows. T-LINT-21: only `src/batch/execute/index.js` and `src/core/save.js` may import `applyChangeSet`; a namespace import, a re-export of it or a dynamic import of `save.js` elsewhere under `src/` is a finding.
Test that fails without it: `tests/unit/batch-execute.test.js` (13 tests; without the change the file fails at import with `Cannot find module` for `src/batch/execute/index.js`) and `tests/unit/lint-rules-writer.test.js` (4 tests; `The requested module '../lint/checks.js' does not provide an export named 'oneExecuteEntryFindings'`).
Fails without, by mutation (each reverted): global refresh forced on, 1 fails; `now` ignored, 2; `dryRun` read, 1; line breaks not normalised, 1; self-check verdict changed, 1; refresh set when the recipe leaves it unset, 1. A temporary second caller of `applyChangeSet` under `src/batch/execute` gives `T-LINT-21 ... applyChangeSet` and 1 finding.
Result: Done
Changed expectations: none
Deviations: none
Decisions inside gaps (log, not yet confirmed by the user):
- A query is flagged to refresh on open only when the recipe says `refreshOnLoad: true`. If the recipe leaves it out, the connection is not changed. The global option of `applyChangeSet` is passed as off so the recipe alone decides.
- Recipe text is trimmed and its line breaks are converted to `\n`, as the editor does, before it is hashed and written.
- A replace action for a query the file does not have is `skipped` with `skip.notApplicable`.
- An unchanged row has `verified: true`, as Collect rows do when there is nothing to write.
Counts after this task: lint 0 findings; unit 1176 tests, 1171 pass, 5 skipped.

### F2-03 Query add
Layer: core/pq, with the execute wiring for `add` actions
Files: src/core/pq/members.js, src/core/save.js, src/batch/execute/changes.js, tests/unit/batch-pq-members.test.js (new), tests/unit/batch-execute.test.js
Do: `writeQueryChanges` appends a `shared` member to the section, adds one metadata Formula item for it, and rebuilds the DataMashup with the new metadata. The new query is connection-only: no connection, table or sheet is created (Q5). `selfCheck` now also fails when the output opens with a `pq.*` warning the input did not have.
Test that fails without it: `tests/unit/batch-pq-members.test.js` (14 tests; 12 failed before the change, one passed for the wrong reason because "not applied yet" already threw `TypeError`, and one is the guard test added after it) and 5 new tests in `tests/unit/batch-execute.test.js`.
Fails without, by mutation (each reverted): name check off, 1 fails; duplicate check off, 1; metadata not written, 9; new-warning check off, 1; names never quoted, 1; keywords not quoted, 1; line comment not closed, 1; constant query id, 1; metadata mismatch guard off, 1; path not URL-encoded, 1. In `changes.js`: exists check off, 1; name check off, 1; no-data check off, 1; old hash recorded for add, 1.
Result: Done
Changed expectations: none
Deviations:
- The execute wiring for `add` is in this commit because the cards name no separate execute task. Remove and rename will do the same.
- The six single-file byte checks from F2-01 still pass with the section now rewritten by `members.js`.
Decisions inside gaps (log, not yet confirmed by the user). The metadata item copies what Excel wrote for the connection-only function in `pq_vba_complex.xlsm`, without the entries that come from a refresh:
- Entries written: `IsPrivate l0`, `FillEnabled l0`, `FillObjectType sConnectionOnly`, `FillToDataModelEnabled l0`, `QueryID`, `BufferNextRefresh l0`, `FilledCompleteResultToWorksheet l0`, `AddedToDataModel l0`. Not written: `ResultType`, `FillStatus`, `FillLastUpdated`, `FillErrorCode`, the column entries and the per-step items (`Section1/Name/Step`) that Excel writes for each step of a query.
- `QueryID` is a version 4 style GUID built from CRC-32 of the name and text, so Preview and Run give the same bytes. It is not random.
- The item path is `Section1/` plus the name through `encodeURIComponent`. Excel's own escaping for characters such as parentheses has not been checked.
- A name is written bare when it is ASCII letters, digits and underscores, starts with a letter or underscore and is not an M keyword; otherwise it is written as `#"..."` with quotes doubled.
- Names are refused when empty, when they start or end with a space, or when they contain a control character. A name that matches an existing section member without regard to case is refused. These rules are mine; the plan gives none.
- An add to a workbook that already opens with `pq.countMismatch` is refused.
- No connection is created, so `inject.refreshOnLoad` has nothing to flag on an added query and is ignored. See the open points.
Real-Excel pack item (for F2-15): add a query to a workbook made by Excel, open it in Excel, and check that it appears in Queries and Connections and in the Power Query editor, that the text is unchanged, and that the workbook saves without a repair message. Repeat with a name that has a space and a name with parentheses.
Counts after this task: lint 0 findings; unit 1195 tests, 1190 pass, 5 skipped.

### F2-04 Query remove
Layer: core/pq, with the execute wiring for `remove` actions
Files: src/core/pq/members.js, src/batch/execute/changes.js, src/batch/execute/index.js, tests/unit/batch-pq-members.test.js, tests/unit/batch-execute.test.js
Do: `writeQueryChanges` removes the member from the section and every metadata item of the query (the query item and its per-step items). A query that has a connection or loads to a table or the data model is refused (`refused.loaded`), and so is one that another query uses (`refused.usedBy`). Core throws `TypeError` for a refusal as a guard; `executeFile` refuses first and writes a row.
Test that fails without it: 11 new tests in `tests/unit/batch-pq-members.test.js` (the file failed to load before the change, for the missing `removeMetadataItems` export) and 4 in `tests/unit/batch-execute.test.js`.
Fails without, by mutation (each reverted): last-member range wrong, 3 fail; step items kept, 1; loaded check off, 1; referenced check off, 2; `#shared` not counted, 1; unknown name check off, 1; remove-with-replace check off, 1; metadata left alone, 7; mismatch guard off for remove, 1. In `changes.js`: refusal off, 2; reason dropped, 2; missing query not skipped, 1; old hash dropped, 1.
Result: Done
Changed expectations: none
Deviations: none beyond the one logged at F2-03 (execute wiring in the same commit).
Decisions inside gaps (log, not yet confirmed by the user):
- A query that another query uses is refused (`refused.usedBy`; `refused.referenced` is kept for rename, where Appendix E gives it). The plan only names the connection or load target case. Without this a remove would leave a query that fails on refresh. A query that reads `#shared` counts as using every query.
- The rule "has a connection" is read literally: `connection-only` queries that Excel made also have a connection element, so they are refused. Only a query added by F2-03 (no connection) can be removed in practice. See the open points.
- Section text removed: for a run of removed members followed by a kept one, from the first removed member's start to the kept member's start; for a run at the end, from the end of the member before it (or the section header) to the last removed member's end. A comment between a removed member and the next one goes with it.
Counts after this task: lint 0 findings; unit 1211 tests, 1206 pass, 5 skipped.

## Open points for the user

1. Planning for Inject, Replace and Align is not assigned. `resolvePlan` only handles Collect and `src/batch/resolve/**` belongs to Scope. `executeFile` needs the recipe text (the query text, the find and with strings, the aligned hash), but `FilePlan` and `Action` carry none of it. I take `executeFile(wb, filePlan, { now, recipe })`, where `recipe` is `plan.recipe`, unless told otherwise. Someone has to extend `resolve` to emit `add`, `replace`, `rename`, `remove`, `replaceText` and `align` actions.
2. F2-09 says "resolve and execute". I build only the execute side in `align.js`. The resolve side (choosing a version by hash, `skipped` for files with no such query) is in Scope's files.
3. Added queries have no connection. Excel writes a `connection` element for every query it makes, including connection-only ones, and lists them in Workbook Connections. Without one, `inject.refreshOnLoad` cannot apply to an added query, and I do not know whether Excel creates the connection itself on open. The plan says never create a load target and does not mention a connection. Options: leave it (current), or write the connection element too (needs `xl/connections.xml` to exist, or a new part, relationship and content type). The real-Excel pack result for F2-03 would settle it.
4. Remove refuses every query that has a connection, which is every query Excel made, including connection-only ones. Only queries added by Quoin can be removed. Options: keep it (current), or also remove the connection element from `xl/connections.xml` for a connection-only query. A query that loads to a table or the data model would still be refused.
