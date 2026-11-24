# What is left to finish Fable, proposed by Scope

Written at the request of the user, who asked for the full plan. It is a proposal for the integrator: the numbering, gates and rules are the plan's and MANAGER.md's, and nothing here changes them. Counts come from the progress files of `fable`, `fable-writer` and `fable-scope` on the day it was written.

## 1. Where things stand

Sixty cards. Three states, because "built" is not "finished":

| State | What it means | Cards |
|---|---|---|
| Finished | built, its tests exist and pass, its phase gate has passed | F0 (14), F1 (8) |
| Built, not proven | engine code and unit tests exist; the browser test the card names is missing, or nobody has opened the output in real Excel, or the phase gate has not passed | F2-01 to F2-12 and F2-15 (13), F3-01 to F3-07 and F3-09 (8, engine only) |
| Open | F2-13, F2-14, F2-16, F3-08 (held), F3-10, F3-11, F4-01 to F4-05, F5-01 to F5-06 | 17 |

So 22 cards are finished, 21 are built but unproven, 17 are open. For F3-05 to F3-09 and F2-04 to F2-09 the card itself names a browser test; those specs do not exist, so they cannot count as finished.

Browser specs the plan names and the repository does not have, as of `fable` 9ce0278: `fable-worked-example`, `fable-recipes`, `fable-privacy`, `fable-memory`. (`fable-failures` and `fable-transform` have since been added by the integrator.)

Transform: a new file per unit (F3-05) is wired in the app, Preview and Get work. New sheet, Combined and Excel compute are not wired, and in place is held; all of them wait for the real-Excel check.

## 2. The critical path

The longest wait is a person opening files in real Excel. The F2, F3 and F5 gates, the release of in-place output and the closure of the real-Excel list all depend on it, and the code changes little while it happens. So the first step is not engineering.

Pack part 1 is Writer's `scripts/make-excel-pack.mjs`, which is on `fable-writer` and not yet merged into `fable` (query and module edits, signature removal, New file, New sheet, Combined, a macro workbook with a new sheet). Pack part 2 is `scripts/make-excel-pack-scope.mjs`: X01 Excel runs it on open on a plain workbook, X02 the same on a macro workbook, X03 in place (after X01 and X02 only). Each case has an input, the output, what Quoin reported, and for X01 and X02 a file with what Quoin itself computes for the same recipe, so the refreshed Excel table can be compared with it. `node scripts/make-excel-pack-scope.mjs --out DIR` writes the zip and `CHECKLIST-SCOPE.md`.

## 3. Work packages

Owners follow MANAGER.md: the integrator owns shared files (`src/app`, workers, `strings.js`, the asset manifest, baselines), Writer owns the writers, Scope owns resolve and the output and transform code.

| Id | Work | Owner | Needs first | Evidence it is done |
|---|---|---|---|---|
| P0 | Run both packs in real Excel and report each box | the user (or anyone with Excel) | nothing | filled checklists; Writer and Scope record the results |
| P1 | F2-13: `fable-cancel` and `fable-failures` specs | integrator, Writer reads | nothing | both specs pass in CI |
| P2 | F2-14: `fable-batch50` (50 files, mixed sheets, one rule, three pins, byte-exact, plan equals run, cancel leaves no partial file) | integrator, Scope supplies the files from the generator | P1 | spec passes; memory returns to baseline |
| P3 | Browser specs for F2-04 to F2-09 (query remove and rename, module replace, replace in code, align) | integrator with Writer | nothing | one spec per card as the plan names them |
| P4 | Transform in the app: allow transform in `PREVIEWABLE`; worker returns `outputs`, `sheetParts`, `rows`; run `NameBook.file` over the whole zip for New file names; one `combineOutputs` call at the end of a Combined run, results in plan order; show Quoin compute versus Excel compute on every row; strings for Scope's codes (list in section 6) | integrator, Scope reviews | nothing | Preview equals run for a transform recipe; `fable-transform` spec per mode |
| P5 | Preview and report for transform: show units, output names and the planning errors (`output.*`, `scope.*`) before run; hide `unchanged` rows by default with a count | integrator | P4 | spec and axe pass |
| P6 | F3-10: `fable-worked-example.spec.js` using `tests/fixtures/generators/worked-example.js`, every number of Fable section 9 asserted (13 units, 10 workbooks, 11 changed, 2 skipped) | integrator, Scope | P4 | spec passes |
| P7 | F3-08 in place: release by passing `allowInPlace` from the worker; browser spec | integrator | P0 results for New file, New sheet, Combined and X01, X02 | spec passes, X03 passed in Excel |
| P8 | F4-01 and F4-03: recipe file save and load (256 KB cap, refuse binary and typed arrays), `quoin.recipes` and `quoin.recent` (names only), allowlist and README changed in the same commit | integrator (pure modules can be done by any agent) | nothing | `fable-recipes`, `fable-privacy` |
| P9 | F4-02 recipe plus folder in one action; F4-04 tokens offered in the Recipe region, unknown tokens flagged in Preview | integrator | P4, P8 | specs and axe pass |
| P10 | F5-01 Firefox and WebKit projects (feature detection, no user-agent sniffing); F5-02 performance numbers in `docs/fable/performance.md`; F5-03 `fable-memory` | integrator | P2, P4 | CI on three browsers; published numbers |
| P11 | F5-04 closure: update `docs/observations.md` and the README only as far as the Excel results justify; F5-05 README and `docs/decisions.md` | integrator, Scope drafts the decisions text for its cards | P0 | documents match the results |
| P12 | Gates: F2-16, F3-11, F4-05, F5-06, each with the ticked list of section 9 | integrator | everything before it | PROGRESS.md boxes with evidence |

Order: P0 starts now and runs beside everything. Then P1, P3 and P4 can run in parallel, because they touch different files. P2 follows P1. P5 and P6 follow P4. P7 waits only for the Excel results. P8 can start at any time and is independent of F2 and F3. P9 follows P4 and P8. P10 and P11 come last, P12 closes each phase. Phases stay in order for gates, as the plan says; the work above may overlap, the gates may not.

## 4. Decisions the user has made

The user answered "yes" to the whole list, which takes the recommendation for each. Status of each:

| Id | Decision | What it means and where it stands |
|---|---|---|
| D1 | Tokens work in injected query and module text; not in the replace `with` text | Built by Scope: `withInjectTokens` in `src/batch/resolve/tokens.js`, one line in `executeFile` (Writer's file, flagged), a planning error `recipe.token` for an unknown token, and tests. The unit for these tokens is the workbook: `{unit.name}` is the file name without extension and `{unit.index}` is 1. |
| D2 | Hide `unchanged` rows by default, with a count and a filter | Integrator, work package P5. Not started. |
| D3 | A unit whose query names a missing column or field is a skipped unit, the other units still land; the "fall back to inject only" sentence of section 9 is dropped | Built by Scope: row verdict `skipped`, reason `skip.missingColumn`, the message names the column; the worked-example data now has two such units and the test asserts 11 changed and 2 skipped. A query that reads a missing field of any record is treated the same way, and the row shows the message, so it is never silent. |
| D4 | In place stays held until X03 passes in Excel; if it fails it moves to the next version | No code change: already unreachable without `allowInPlace`. |
| D5 | CI is enough evidence for Firefox and WebKit if they cannot run in the build environment | Integrator, P10. |
| D6 | The user runs both Excel packs now, in one sitting, and reports what they saw | Waiting on the user. Results go to the integrator, who tells Writer and Scope what to rework. |

## 5. What could go wrong, and how it is covered

- A written file that Excel repairs although every reader here accepts it. Covered by the packs and by a second reader (openpyxl and LibreOffice) on every output mode, never by a claim that Excel is fine.
- A silent change in a part the writers touch. Covered by `selfCheck`: touched parts must equal the declared text and must equal the original once the declared insertions are removed; the check does not trust the writer.
- Output naming that collides across files. Covered by one `NameBook.file` over the whole zip and one `NameBook.sheet` per workbook; workers never decide uniqueness across files.
- A worker that never returns on a pathological regex. Covered by the pool's per-file time limit; the browser spec for it is part of P1.
- Building ahead of the real-Excel gate. Scope did this for F3-05 to F3-09 and says so; in place is unreachable without `allowInPlace`; if a pack case fails, the mode is reworked, nothing else is.

## 6. Strings and codes the integrator has to add

Planning errors: `scope.headerOnSheets`, `scope.needsInspect`, `scope.pattern`, `recipe.patternAdd`, `align.noSource`, `output.rangeRequired`, `output.range`, `output.inPlaceScope`, `output.overlap`, `output.nameRequired`, `output.excelMode`.

Skips: `skip.noMatchingUnit`, `skip.notApplicable`, `skip.missingColumn` (the row reason is the engine's message, which names the column).

Row reasons for a unit: `unit.parse` (with line and column), `unit.error`, `unit.missingColumn` (inside a run result; the report row says `skip.missingColumn`), `unit.notTable`, `unit.binding`, `unit.nameCollision`, `unit.missing`, `recipe.token`, `m.rows`, `m.timeout`, `m.depth`.

Row reasons for an output: `refused.tooLarge`, `refused.cellTooLong`, `verify.readBack`, `refused.noSheet`, `refused.empty`, `refused.outOfSheet`, `refused.overlapsTable`, `refused.overlapsMerge`, `refused.overlapsFormula`, `refused.unsupportedSheet`, `refused.rangeTooSmall`, `refused.overlap`, `refused.inPlaceHeld`.

Row reasons for Excel compute (each should offer "Quoin runs it now"): `refused.sheetUnit`, `refused.noName`, `refused.noQuery`, `refused.noLoadTarget`, `refused.overlap`.

Flag on a run: `output.nameTaken`.

## 7. Definition of done, mapped to evidence (plan section 10)

| Item | Evidence to collect |
|---|---|
| 50 files, one rule, three pins, Preview correct | `fable-batch50` and the worked-example spec |
| Every output opens in real Excel | the filled checklists of both packs |
| Every output verifies against its input | `verified` on every row; `selfCheck` and read-back tests |
| The report accounts for all files and units | report test and the worked-example numbers |
| Cancel leaves no partial file | `fable-cancel` |
| Memory returns to baseline | `fable-memory` |
| A single file still does what it did in `beta` | the F0 parity spec, rerun at F5-06 |
