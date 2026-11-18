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

## Strings and error codes for trunk

None so far. All failures reuse codes already in `ERRORS` (`write.selfcheck`, `check.query`, `check.vba`, `check.part`, `pq.format`, `m.parse`, `vba.*`).

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

## Open points for the user

1. Planning for Inject, Replace and Align is not assigned. `resolvePlan` only handles Collect and `src/batch/resolve/**` belongs to Scope. `executeFile` needs the recipe text (the query text, the find and with strings, the aligned hash), but `FilePlan` and `Action` carry none of it. I will take `executeFile(wb, filePlan, { now, recipe })`, where `recipe` is `plan.recipe`, unless told otherwise. Someone has to extend `resolve` to emit `add`, `replace`, `rename`, `remove`, `replaceText` and `align` actions.
2. F2-09 says "resolve and execute". I will build only the execute side in `align.js`. The resolve side (choosing a version by hash, `skipped` for files with no such query) is in Scope's files.
