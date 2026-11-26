# Quoin — *Fable* · Implementation Plan for Sonnet

**Source documents:** `quoin-fable.md` (the decision document, called **Fable** below) and the `beta` branch of `github.com/datakid/power-query-manager`. Wherever this plan says **Verified**, the statement was checked against `beta` source files, not the README.

**Audience:** Sonnet, the implementer. Read the whole document before writing any code. Read it again at the start of every phase.

**Authority order, highest first:**
1. The guardrails in §1 of this plan.
2. The code on `beta`. Where Fable and the code disagree, the code wins. Record the disagreement in `docs/fable/PROGRESS.md` under *Deviations*.
3. Items marked **Decided** in Fable. Do not reopen them.
4. This plan's task cards.
5. Everything else in Fable.

If two rules conflict and this order doesn't settle it, stop and ask (§11).

---

## Contents

0. How to work through this plan
1. Guardrails (non-negotiable)
2. Ground truth: what `beta` actually contains
3. Fable decisions you must not reopen
4. Answers to Fable's open questions, and the stop gates they create
5. Target architecture: folders, layers, data shapes, worker protocol
6. Task protocol: the loop, the task card, PROGRESS.md
7. Test strategy: what proves everything looks and works right
8. Phases and tasks (F0 to F5)
9. Phase gates
10. Definition of done for Fable
11. Stop and ask
12. Appendices: recipe schema, report columns, naming rules, comment stripping, strings and error codes

---

## 0. How to work through this plan

- Work one phase at a time, in order: F0, F1, F2, F3, F4, F5. Do not start a phase until the previous phase's gate in §9 has passed and is recorded.
- Inside a phase, do tasks in the listed order unless a task card says otherwise.
- **One task is one unit of work.** It touches one layer, one recipe, or one step of the pipeline. It ends with a test that would fail without the change. If a task description needs the words "and also", split the task and record the split in PROGRESS.md.
- **Vertical slices.** Every phase ends with a usable path: drop → choose → preview → get. A phase that can't be used is not done.
- Where this plan says nothing, choose the smaller option that matches the existing code's habits. Where this plan is explicit, don't improve on it without asking first.

---

## 1. Guardrails (non-negotiable)

### 1.1 Code comments: never add them, strip any you find

This is the first rule because it's the easiest to break by habit.

- **Never add a comment to any code file.** This covers JavaScript (`.js`, `.mjs`), CSS, HTML, SVG, worker files, test files, scripts, config files and fixture generators.
- Banned forms include line comments (`//`), block comments (`/* */`), JSDoc (`/** */`), HTML and SVG comments (`<!-- -->`), commented-out code, `TODO`, `FIXME`, `XXX`, `NOTE`, lint-disable directives, licence banners, section dividers and "explanatory" one-liners.
- **Strip every comment you find** in any file you touch, and anywhere the comment sweep in F0-01 finds one. Stripping changes no behaviour: remove the comment, keep the code byte-identical otherwise, and run the full suite.
- Explanations belong in `docs/decisions.md`, `docs/fable/*.md`, PROGRESS.md, commit messages and test names. They never belong in code.
- **Comments inside data are not code comments. Never strip these:**
  - M source inside string literals and fixtures, such as `'// x'` in tests. Decision 4 in `docs/decisions.md` depends on M `//` comments.
  - VBA source inside string literals, such as `"' Form layout not included."` in `src/core/export/files.js`.
  - URLs and regular expressions that contain `//` or `/*`.
  - The hashbang line `#!/usr/bin/env node`, which is not a comment.
  - Markdown files.
- **Verified:** `tests/lint/checks.js` rule **T-LINT-1** already fails the build on any comment in `.js`, `.mjs`, `.css`, `.html` and `.svg` files outside `docs/`, `node_modules/`, and the fixture folders `external/`, `workbooks/` and `expected/`. Keep this rule. Extend it in F0-01 to any new code file type you introduce. A lint finding of T-LINT-1 is a blocking defect.

### 1.2 Product constraints carried from `beta` (all Verified)

- **No runtime dependencies.** Use plain ES modules with no framework, no bundler and no CDN. Imports in `src/` and `sw.js` must be relative (T-LINT-2). Don't add any `dependencies`. Don't add `devDependencies` without asking (§11).
- **No network after load.** Use no `fetch` outside `sw.js`, and no `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or `importScripts` (T-LINT-4). Keep the CSP identical in its four copies (T-LINT-14).
- **No accounts, analytics, cookies, IndexedDB or sessionStorage** (T-LINT-8, T-PRIV-3).
- **No HTML injection.** Use no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string timers, inline handlers, inline scripts or inline styles (T-LINT-5).
- **Tokens-only CSS.** Use no raw hex or rgb outside `styles/tokens.css`, no raw px spacing, radii only from `--r-*` tokens, and no fixed heights of 24 px or more (T-LINT-3, -6, -17). Keep the self-hosted Atkinson Hyperlegible Next and Commit Mono fonts.
- **All user-visible text lives in `src/ui/strings.js`.** Text must not contain `!`, "please", "oops", "sorry" or emoji (T-LINT-9). Every `new QuoinError('code')` needs an entry in `ERRORS` (T-LINT-15).
- **`src/core` never touches `document`, `window` or `navigator`** (T-LINT-7).
- **`selfCheck` is defined and called only in `src/core/save.js`.** It's never wrapped in a `try` block whose `catch` doesn't rethrow (T-LINT-12).
- **The query string is read only in `src/app/main.js`** (T-LINT-10).
- **Leave the shipped wordmark alone.** "Fable" appears only in docs and in `document.title`.

### 1.3 Data safety

- **Never write to an original file.** No code path may obtain a writable handle to a dropped or picked input. In-place output means the **output copy** is changed in place, never the source on disk. It's opt-in and labelled.
- **Plan and run share one function.** The bytes Preview produces are the bytes Get releases, for the same plan. Any divergence is the highest-severity defect class in the project.
- **Release nothing unverified.** Every output passes the generalised `selfCheck` before it's offered. A file that fails is not released and is reported as `not-released`.
- **No half-written output.** A unit either lands or it doesn't. Cancel leaves no partial file on disk and no partial zip.
- **Never persist binary data.** Workbook bytes, indexes and results are never stored. Don't add base64 transport, base64 storage, binary snapshots, or caches of user files. DataMashup's base64 is part of the file format and stays inside `src/core/pq`.
- **Buffers cross worker boundaries as transferables** (`ArrayBuffer` in the transfer list), never cloned and never converted to strings. `File` objects may be posted to a worker, because structured clone shares the blob and doesn't copy it.
- **One bad file never stops a batch.** The queue continues and the report accounts for every file and every unit.

### 1.4 Tests and honesty

- **Never weaken, skip, delete or `.only` an existing test** to get green. Change an existing expectation only when a task card names it, and log the change under *Changed expectations* with the reason.
- **Never update visual baselines blind.** Run `--update-snapshots` only after opening each new image and describing it in PROGRESS.md.
- **Never claim real Excel, Firefox or WebKit verification that you didn't run.** Real-Excel checks are performed by a human using the pack from F2-15 and F3 tasks. Until a human reports results, observations stay "not run".
- **Every new surface gets its keyboard path and its axe check in the same task.** Never defer them to a cleanup task.

### 1.5 Scope

Fable §12 is the scope floor. Do not build any of these: running VBA, cloud features, accounts, sync, `.xls`, `.xlsb`, password-protected files, the data model, an assistant or chat, network connectors, cross-file state in a recipe, WASM, or printing a batch. Also add no tours, no tips, no greetings and no animation in the run bar.

---

## 2. Ground truth: what `beta` actually contains

Each row was checked against the named file. Where Fable said *(verify)*, the answer is here. **Re-check each row on your checkout during F0-01.** If anything differs, the code wins: record it and adjust.

| # | Topic | Verified fact | File | Consequence for Fable |
|---|---|---|---|---|
| G1 | Limits | File ≤ 200 MB. ≤ 20,000 entries. ≤ 1 GB inflated total. ≤ 512 MB per entry. Compression ratio ≤ 200. Run timeout 30,000 ms. Row cap 1,000,000. Stored results ≤ 32 and ≤ 6,000,000 cells. | `src/core/limits.js` | The pool's byte budget must still admit one 200 MB file at pool size 1. Per-file run limits mirror `timeoutMs` and `maxRows`. |
| G2 | Worker | There is one module worker, `src/workers/m-worker.js`. Its messages are `run`, `run-steps`, `run-many`, `pin`, `release`, `binding`, `rows` and `export`. No pool exists. Exports already transfer `bytes.buffer`. | `m-worker.js` | Keep this file as **the single worker entry**. Add `open`, `inspect`, `apply` and `cancel` beside the existing messages. Change none of the existing ones. |
| G3 | Runner | `src/app/runner.js` owns one `Worker`. Cancel and timeout call `terminate()` and bump `generation`. Timeout adds a 2 s grace period. | `runner.js` | In a pool, terminating a worker must not kill other jobs. Runner leases a dedicated pool worker, and the pool replaces that worker after it's terminated. |
| G4 | Session | `Session` holds one workbook: `wb`, `queryEdits`, `moduleEdits`, `bindings` and `snapshotCache`. `download()` calls `buildWorkbook`. | `src/app/session.js` | Open question 1: `Session` survives unchanged as the per-file workspace state. A new `SetSession` wraps the set. |
| G5 | Save and verify | `buildWorkbook(wb, {queryEdits, vbaEdits, refreshOnLoad, acknowledgeSignature, checkSection})` clones the package, applies edits, writes, then calls `selfCheck`. `selfCheck` re-opens the output and compares every edit and every untouched entry by compressed bytes and CRC. It **requires the query count to be unchanged** and reports every failure as `write.selfcheck`. | `src/core/save.js` | Adding, removing or renaming queries and modules, and adding sheets, are impossible today. F2-01 generalises `selfCheck` to an explicit ChangeSet **inside `save.js`** so T-LINT-12 still holds. The `verify` layer in Fable §4 is therefore split. The byte check stays in `save.js`. Verdicts and the Preview/Run hash equality live in `src/batch/verify`. |
| G6 | Query writer | `writeQueryEdits` replaces **existing** section members (`rebuildSection`). It sets `refreshOnLoad="1"` only on an existing connection. `openWorkbook` warns `pq.countMismatch` when metadata items ≠ shared members. | `src/core/pq/writeback.js`, `workbook.js` | **Inject add, remove and rename are new core work.** They must also update the metadata Formulas items, or the output warns and becomes unwritable. |
| G7 | VBA writer | Module text edits exist (`writeVbaProject(project, edits)`). A signed project needs `acknowledgeSignature`. Signature removal rewrites `[Content_Types].xml` and drops the signature parts. | `save.js`, `opc.js` | Module replace exists. Module add and remove need dir-stream and PROJECT-stream writing. *(verify `src/core/vba/writeback.js` and `dir-stream.js` before planning F2-07.)* |
| G8 | Drops | `main.js` `handleDrop` refuses folders (`S.dropFolder`) and multiple files (`S.dropOne`). Tests **T-B-16** assert "Drop one workbook." and "That is a folder." | `src/app/main.js`, `tests/e2e/drop.spec.js` | F0-10 deliberately changes these expectations, and the change must be logged. A single-file drop still opens the workspace (keep that test as is). |
| G9 | Storage | Only `quoin.theme` is allowed. T-LINT-8 accepts the literal key `'quoin.theme'` and nothing else. T-PRIV-3 expects `local: ['quoin.theme']`. | `tests/lint/checks.js`, `tests/e2e/privacy.spec.js` | Fable §7 adds recent set names and saved recipes. F4 changes T-LINT-8 to an exact allowlist of three keys and changes T-PRIV-3. The README Privacy section must be updated in the same task. |
| G10 | Service worker | Pre-caches only `asset-manifest.json` files. Handles same-origin GET only. Caches no user files. | `sw.js` | Fable §7 *(verify)* is confirmed. Add no cache rules. |
| G11 | xlsx export | `tableToXlsx(table, culture)` writes a **new standalone** one-sheet workbook ("Result") with inline strings, its own `styles.xml` and date styles. | `src/core/export/xlsx.js` | Open question 2: it's a head start for **new file per unit** and for **combined** (after a multi-sheet extension). It's **no** help for adding a sheet to an existing workbook, which is new core work. |
| G12 | Zip writer | `writeZip` builds the whole archive in memory. It's classic zip only: ≤ 65,534 entries and < 4 GiB. New entries take DOS timestamps from `now` (default `new Date()`). `zipFiles` de-duplicates names as `name (2).ext`. | `src/core/zip-write.js`, `export/files.js` | (a) Plan and Run must pass the **same frozen `now`**, or the bytes differ. (b) Zip output needs a size ceiling (open question 4). (c) Collect keeps the existing ` (n)` rule inside a file's folder. New fan-out outputs use Fable's `-2` rule. |
| G13 | Index data | `openWorkbook` gives `sheets[{name, sheetId, state, part, type}]`, `tables[{name, sheet, ref, headerRowCount, tableType, columns}]`, `queries[{name, load, original, group, connection}]`, `vba{signed, project{locked, writable, modules}}` and `definedNames`. | `src/core/workbook.js` | Most of the index needs no new parsing. "Non-empty sheet" needs the sheet part (lazy, only when a scope uses it). |
| G14 | Lint | T-LINT-1 through -17 as described in §1.2. The lint walks the whole repository except the exclusions. | `tests/lint/checks.js` | New lint rules go into the same file and follow the same style (§7.3). |
| G15 | Tests | `npm test` runs lint, then `node --test tests/unit/*.test.js`, then Playwright (Chromium only). There are 36 visual baselines in `tests/__visual__`. Axe runs in `tests/a11y/a11y.spec.js`. Fixtures are built by `tests/fixtures/generators/build.js`, plus `hostile.js`. | `package.json`, tests | New suites follow the same layout. Don't commit hundreds of generated workbooks. Generate large sets in memory or in a temp folder. |
| G16 | Progress habit | `docs/next/PROGRESS.md` records each phase as *Done / Changed expectations / Not reproduced / Blocked / Deviations*. | `docs/next/PROGRESS.md` | Use the same structure in `docs/fable/PROGRESS.md`. |
| G17 | Engine coverage | The library has 545 entries: 511 full, 2 partial, 32 unsupported. | README, `docs/m-coverage.md` | Matches Fable. |

---

## 3. Fable decisions you must not reopen

- **Evolve, don't rebuild.** Keep `src/core`. Rebuild the shell around a set of files.
- **Four nouns:** Files, Recipe, Preview, Result. Never add a fifth.
- **Three moves:** Drop, Choose, Get. The app is in exactly one of them.
- **`plan = resolve(recipe, set)` → `run(plan)` → `report(plan)`.** Resolution is pure, deterministic and inspectable.
- **Two layers of scope:** a scope rule plus per-file overrides (pins). Never write one clever rule that encodes the exceptions.
- **Precedence:** a pin beats the rule. An explicit exclude beats an include. When two recipes set the same field of the same file, the last one chosen wins and the replacement is shown. Injecting an existing name is `replace` with the old hash shown.
- **Fan-out:** one unit, one output. Report rows are per unit.
- **The five recipes:** Collect, Inject, Replace in code, Transform, Align. Two compute modes appear on every row: *Quoin runs it now* and *Excel runs it on open*.
- **Layering:** `recipe`, `resolve`, `execute`, `verify`, `session`, `shell` (adjusted for G5 as described in §5).
- **One worker pool, one entry, one protocol.** A job is one file with all its units. Buffers are transferables. Cancel uses a flag, then terminate. One failure never stops the queue.
- **No WASM.**
- **Shell:** one screen. Top bar, Files on the left, Recipe in the centre, Result on the right, and a run bar. Advanced controls sit behind one **More** disclosure that is always closed at rest. The voice is quiet.
- **Zero feature loss** on a single file (Fable §6.1).

---

## 4. Answers to Fable's open questions, and the stop gates they create

These are Opus's recommendations. Items marked **STOP** need the user's confirmation before the named task starts. Don't guess.

| # | Question | Answer | Gate |
|---|---|---|---|
| Q1 | How much of `src/app` survives? | `Session`, `Runner`, `workspace.js`, `orchestrator.js`, `commands.js`, `file-save.js` and the dialogs all survive. The single-file workspace mounts inside the centre region. `main.js` keeps boot, theme, drop wiring and query-string handling, and gains set routing. New code: `set-session.js`, `pool.js`, `intake.js`, `outputs.js`. | none |
| Q2 | Does the xlsx export help the cell writer? | Yes for **new file** and **combined** (`tablesToXlsx`, a multi-sheet extension of the same code). No for **new sheet** or **in place**, which need splice-based edits to an existing package. | none |
| Q3 | Signed VBA: confirm once per set or once per file? | **Once per set.** The confirmation names the count ("4 signed workbooks will lose their signatures"). The report marks each affected file. | **STOP before F2-12:** confirm "once per set" with the user. |
| Q4 | What is the memory ceiling for a set? | The **in-flight byte budget** is 768 MiB of inflated bytes by default, or 384 MiB when `navigator.deviceMemory ≤ 4`. A single job larger than the budget runs alone and is never refused for budget alone. **Zip output ceiling:** 1 GiB of compressed outputs, plus the classic zip limits (G12). Above the ceiling, Get offers folder output where `showDirectoryPicker` exists. Elsewhere it refuses with: "These outputs exceed what one zip can hold. Choose fewer files." These numbers are starting values, measured and published in F5. | none (measure in F5) |
| Q5 | Can *Excel runs it on open* create a new load target? | **Not in this version.** It reuses an existing load target: an existing query's table, or connection-only with `refreshOnLoad`. Creating a new query table needs a table part, a queryTable part, a connection and metadata `FillEnabled`, which is too risky before real-Excel checks exist. Rows with no usable target show the reason and offer *Quoin runs it now*. | **STOP before F3-09:** confirm the "reuse only" scope. |
| Q6 | What are the Inject throughput and folder-size targets? | Initial targets: index 500 files in under 60 s with the UI responsive (Fable §11); Inject ≥ 1 small file per second per worker; the largest responsive folder is ≥ 2,000 files. Measure in F5 and publish in `docs/fable/performance.md`. | none |

Further interpretations that need the user's sign-off:

| # | Ambiguity in Fable | Recommendation | Gate |
|---|---|---|---|
| A1 | **New file per unit:** does the output contain only the unit's result, or a copy of the source workbook plus the result? Fable says both `{file}__{unit}.xlsx` and "extensions preserved". | The output contains the **result only**, as a values-only `.xlsx`. "Extensions preserved" is read as "the collision suffix goes before the extension" (`a__Data-2.xlsx`). A copy of the source plus a result sheet is already what *new sheet* mode produces. | **STOP before F3-05** |
| A2 | How does M see a **sheet** unit? `Excel.CurrentWorkbook` exposes only tables and named ranges. | For *Quoin runs it now*, the unit is added to the run's snapshot as `Excel.CurrentWorkbook(){[Name="{unit.name}"]}[Content]`. A table unit appears with its headers. A sheet unit appears as its used range with columns `Column1…ColumnN` and **no header promotion**, so nothing is inferred. For *Excel runs it on open*, sheet units have no Excel-visible target, so those rows say so (ties to Q5). | **STOP before F3-03** |
| A3 | What does the scope option "only those with a header row" mean? | It applies to **table units only**: tables with `headerRowCount ≥ 1`. For sheets the option is disabled with a reason. Guessing headers from cell types would be silent inference. | **STOP before F3-01** |
| A4 | What syntax does "sheets matching a name pattern" use? | The default is a case-insensitive glob with `*` and `?`. Regex sits under **More**. | none |
| A5 | What happens when a rename target is referenced by other queries? | **Refuse** with `refused: referenced by {names}`. References are never rewritten silently. | none |

---

## 5. Target architecture

### 5.1 Folders

```
src/core/                 unchanged role: pure file-format logic (zip, xml, opc, cfb, ovba, pq, m, export, diff, print)
src/core/save.js          gains applyChangeSet; selfCheck generalised; still the only home of selfCheck
src/core/pq/              gains member add / remove / rename writers (F2)
src/core/vba/             gains module add / remove writers (F2, after verify)
src/core/sheet/           new: worksheet part writer, workbook sheet append, styles splice (F3)
src/batch/recipe/         pure data: parse, validate, serialise, tokens
src/batch/index/          pure: workbook → FileIndex, hashing
src/batch/resolve/        pure: recipe + FileIndex[] → Plan
src/batch/execute/        pure, per file: workbook + FilePlan → ChangeSet → bytes via core/save.js
src/batch/verify/         pure: verdicts, report rows, preview/run hash equality
src/batch/protocol.js     pure: worker message constructors and validators
src/workers/m-worker.js   the one worker entry: existing messages plus open / inspect / apply / cancel
src/app/pool.js           worker pool (needs navigator, so it lives in app)
src/app/set-session.js    stateful: set, plan, progress, report; the single source of truth
src/app/intake.js         drops, folder entries, file inputs, directory picker
src/app/outputs.js        folder output and zip output, release after verify
src/app/session.js        unchanged: single-file workspace state
src/ui/set/               shell regions: top bar summary, files, recipe, result matrix, run bar
styles/                   new component styles use tokens only
tests/unit/batch-*.test.js, tests/e2e/fable-*.spec.js, tests/a11y additions, tests/fixtures/generators/sets.js
docs/fable/               00_FABLE.md (copy of Fable), 01_PLAN.md (this file), PROGRESS.md, performance.md
```

### 5.2 Layer rules, enforced by lint in F0-03

| Layer | May import | Must not use |
|---|---|---|
| `src/core` | `src/core` only | `document`, `window`, `navigator`, `self`, `localStorage`, `Worker`, `postMessage`, `src/batch`, `src/app`, `src/ui` |
| `src/batch` | `src/core`, `src/batch` | the same DOM and worker globals; `resolve` must not import `execute` or `verify` |
| `src/workers` | `src/core`, `src/batch` | `src/app`, `src/ui`, DOM globals |
| `src/app` | anything | holds state; no rendering logic beyond calling `src/ui` |
| `src/ui` | `src/ui`, `src/core` display helpers already used today | `src/batch/execute`, `src/batch/verify`, `src/workers`, any business state |

`resolve` runs on the main thread and must keep up with typing. Target: resolving a 500-file index in under 16 ms per keystroke, measured in F3-01.

### 5.3 Data shapes

Every shape is plain, serialisable data that survives structured clone. Write them exactly as shown. Add fields only through a logged decision.

```js
FileRef   = { id: 'f0007', name: '2024-sales.xlsx', relPath: 'east/2024-sales.xlsx', size: 51564, lastModified: 1731542400000, file: File }

FileIndex = {
  id, name, relPath, size,
  status: 'ready' | 'refused',
  refused: null | { code: 'file.xls' | 'file.xlsb' | 'file.encrypted' | 'file.strict' | 'file.ods' | 'file.notWorkbook' | 'file.tooLarge' | 'file.unsupportedExtension' | 'file.lockFile', },
  format: 'xlsx' | 'xlsm' | 'xltx' | 'xltm' | null,
  sheets:  [ { name, index, state: 'visible' | 'hidden' | 'veryHidden', type: 'worksheet' | 'chartsheet' | string, part, nonEmpty: null | boolean } ],
  tables:  [ { name, sheet, ref, headerRowCount, tableType } ],
  queries: [ { name, isFunction, load: { kind, sheet?, ref?, tableName? }, hash } ],
  modules: [ { name, kind, hash } ],
  pq:  { editable: boolean, reason: null | string },
  vba: { present: boolean, signed: boolean, locked: boolean, writable: boolean },
  warnings: [ { code, part? } ]
}

Unit      = { fileId, kind: 'workbook' | 'sheet' | 'table', name, index }

Recipe    = see Appendix A (JSON, version 1)

Plan      = {
  recipe, now: '2026-11-14T10:00:00.000Z', createdBy: 'resolve',
  summary: { files: 10, units: 13, groups: [ { unitsPerFile: 1, files: 7 }, { unitsPerFile: 2, files: 3 } ] },
  files: [ FilePlan ],
  orphanPins: [ { file, units } ],
  errors:   [ { code, fileId?, detail } ]
}

FilePlan  = { fileId, source: 'rule' | 'pin', units: [ Unit ], actions: [ Action ], skipped: null | { code: 'skip.noMatchingUnit' | ..., detail } }

Action    = { unit, op: 'collect' | 'add' | 'replace' | 'rename' | 'remove' | 'replaceText' | 'transform' | 'align',
              target: { type: 'query' | 'module' | 'sheet' | 'range', name }, compute: 'quoin' | 'excel' | null,
              output: null | { mode: 'newFile' | 'newSheet' | 'combined' | 'inPlace', name }, replaces: null | { recipeIndex, hash } }

ChangeSet = { queries: { add: Map, replace: Map, rename: Map, remove: Set }, modules: { add: Map, replace: Map, remove: Set },
              sheets: { add: [ { name, cells } ], write: [ { sheet, range, cells } ] }, refreshOnLoad: Set, acknowledgeSignature: boolean }

ApplyResult = { fileId, bytes: Uint8Array | null, sha256: string | null, changes: [ Change ], warnings: [ ], rows: [ ReportRow ] }

ReportRow = see Appendix B
```

Hashes are SHA-256 (`crypto.subtle.digest`) over the UTF-8 encoding of the comparison text. Query text uses `normalizeQueryText`, the same function the session and the writer share (decision 15). Module text uses the exact visible text. Display the first 8 hex characters and compare the full hash.

### 5.4 Worker protocol

The protocol is defined once in `src/batch/protocol.js`. It's used by `m-worker.js` and `pool.js`, and nowhere else invents message shapes.

```
open(fileRef)            → { type: 'opened', fileId, index: FileIndex }   | { type: 'refused', fileId, code }
inspect(fileRef, need)   → { type: 'inspected', fileId, index }              need: ['nonEmpty'] etc., lazy parts only
apply(fileRef, filePlan, { now, dryRun, limits, culture })
                         → { type: 'applied', fileId, result: ApplyResult } with result.bytes.buffer in the transfer list
cancel(fileId | 'all')   → { type: 'cancelled', fileId }
progress                 ← { type: 'progress', fileId, unitId, phase: 'open' | 'run' | 'write' | 'verify', pct }
```

- The existing messages (`run`, `run-steps`, `run-many`, `pin`, `release`, `binding`, `rows`, `export`) stay exactly as they are.
- **`dryRun` changes only whether the main thread releases the bytes.** `execute` must not branch on it. A unit test asserts that `execute` never reads it.
- `apply` with `dryRun: true` is Preview. It produces real bytes and hashes, and the main thread discards the bytes after recording `sha256`. Get re-runs `apply` with the same `now`. `verify` asserts that each file's Run `sha256` equals its Preview `sha256`. A mismatch is reported as `verify.planDrift`, the file is not released, and the run is marked as having a defect.

### 5.5 Pool

- Size is `min(4, max(1, hardwareConcurrency − 1))`, lowered to at most 2 when `deviceMemory ≤ 4`. Inject `hardwareConcurrency`, `deviceMemory` and the `Worker` factory so the pool is testable in Node.
- Admission is capped by the byte budget (Q4). A job's estimated inflated bytes come from the zip central directory sizes of the entries the plan touches, or the whole file for `open`.
- A job is one file. It's opened once, written once and verified once. The queue is FIFO in `relPath` order.
- **Cancel:** set the flag. The worker checks it between units. If a worker doesn't acknowledge within 1,000 ms, it's terminated and replaced. Cancelled files are reported as `cancelled` with no output.
- If a job fails, the failure is reported and the queue continues.
- `lease()` gives `Runner` an exclusive worker for interactive single-file runs. When `Runner` terminates it on timeout or cancel, the pool spawns a replacement.

---

## 6. Task protocol

### 6.1 The loop for every task

1. Re-read the task card and the guardrails in §1.
2. Read every file you'll change, in full.
3. **Write the test first.** Run it and confirm it fails for the right reason. Paste the failing assertion line into PROGRESS.md.
4. Implement the smallest change that passes.
5. Run `npm run test:lint`, `npm run test:unit` and `npm run test:browser`. All three must pass. Lint must report **0 findings**, including T-LINT-1 (no comments).
6. **Confirm the test would fail without the change:** temporarily revert the implementation, watch the new test fail, then restore it. Record "fails without: yes" in PROGRESS.md.
7. If a surface changed: run the keyboard path and axe in both themes, check visual baselines (§7.6), and check contrast pairs.
8. Update docs in the same task: README if user-visible behaviour changed, `docs/decisions.md` if a choice was made, and PROGRESS.md always.
9. Commit with the message `F{phase}-{nn}: {imperative summary}`. One task per commit.

### 6.2 Task card template

Copy this template into PROGRESS.md for each task as you start it:

```
### F2-03 Query add
Layer: core/pq
Files: src/core/pq/members.js (new), src/core/save.js, src/ui/strings.js, tests/unit/batch-pq-add.test.js
Do: …
Do not: …
Test that fails without it: …
Acceptance: …
Result: Done | Blocked (reason) | Split into F2-03a/F2-03b
Fails without: yes
Changed expectations: none | list
Deviations: none | list
```

### 6.3 PROGRESS.md structure

Keep the structure `docs/next/PROGRESS.md` already uses. Each phase has these sections: **Done**, **Changed expectations**, **Not reproduced**, **Blocked**, **Deviations**, and **Gate**. The Gate section is the §9 checklist with every box ticked and evidence for each.

---

## 7. Test strategy: what proves everything looks and works right

### 7.1 Existing suites (must stay green throughout)

- `npm run test:lint`: T-LINT-1 through -17 report 0 findings.
- `npm run test:unit`: every unit test passes.
- `npm run test:browser`: every Playwright spec passes, including the a11y specs and the 36 visual baselines, unless a task card names a deliberate change.

### 7.2 New unit suites (`node --test`, no browser)

| Suite | Proves |
|---|---|
| `batch-recipe.test.js` | parse, validate and serialise round-trip; unknown fields give warnings, never fatal; a newer `v` is refused; tokens are listed; token errors are reported |
| `batch-index.test.js` | every fixture indexes; every refusal code maps from `openWorkbook` errors; hashes are stable and equal for text that differs only by trimming; `nonEmpty` stays `null` until it's inspected |
| `batch-resolve.test.js` | every scope type; pins by exact name, then by relative path; orphan pins; `skip.noMatchingUnit`; precedence; divergence summary; determinism (same input gives a deep-equal plan; shuffled file order gives the same plan); 500-file speed under 16 ms |
| `batch-execute.test.js` | each op produces the expected ChangeSet; `dryRun` is never read; the same `now` gives byte-identical output on two calls |
| `batch-save.test.js` | the generalised `selfCheck` accepts exact ChangeSets and rejects each tampering case (an extra part, a missing add, a changed untouched part, a rename that left the old name) |
| `batch-pq-members.test.js` | query add, remove and rename: section, metadata items and connections stay consistent; no `pq.countMismatch` on re-open |
| `batch-sheet.test.js` | a new worksheet part, a content-type override, a workbook rel, a `<sheet>` appended last with a unique `sheetId`, a styles splice; the sheet name sanitiser; collision suffixes |
| `batch-pool.test.js` | the size formula; byte-budget admission; an over-budget single job runs alone; FIFO order; failure continues; cancel acknowledged, or terminated after 1,000 ms and replaced; `lease()` |
| `batch-report.test.js` | one row per unit; verdict mapping; CSV columns in Appendix B order; the formula-injection guard is on |
| `batch-naming.test.js` | Appendix C rules: Excel sheet names, output file names, `-2` suffixes, case-insensitive collisions, reserved names, code-point truncation (reuse `src/core/filename.js`) |
| `lint-rules.test.js` | each new lint rule flags a synthetic bad source and passes a good one |

### 7.3 New lint rules (in `tests/lint/checks.js`, same style as the existing rules)

- **T-LINT-18 layer purity:** in `src/batch/**`, no `document`, `window`, `navigator`, `localStorage`, `self`, `postMessage` or `Worker`.
- **T-LINT-19 import direction:** enforces the table in §5.2.
- **T-LINT-20 base64 containment:** `btoa`, `atob`, `base64Encode` and `base64Decode` appear only in `src/core/**`. If `beta` already has uses elsewhere, list them in PROGRESS.md and ask before changing them (§11).
- **T-LINT-21 one execute entry:** only `src/batch/execute/index.js` may import `applyChangeSet`. This guards "plan and run share one function".
- **T-LINT-8 (changed in F4):** the exact allowlist is `quoin.theme`, `quoin.recent` and `quoin.recipes`.
- **T-LINT-1 (extended in F0-01):** covers every code file type present in the repository.

### 7.4 New browser suites (Playwright, Chromium first; Firefox and WebKit in F5)

| Spec | Proves |
|---|---|
| `fable-intake.spec.js` | folder drop (`webkitGetAsEntry` recursion), multi-file drop, a `webkitdirectory` input, unsupported files listed as skipped with reasons, `~$` lock files skipped, a single file opening the workspace directly |
| `fable-parity.spec.js` | **every row of Fable §6.1** is reachable from a set by keyboard and by pointer, and behaves as in `beta` (open file → list → editor → edit marker → revert → review changes → run → grid → compare → export each format → print preview → shortcuts sheet → theme → download with read-back) |
| `fable-responsive.spec.js` | indexing 200 generated files while typing in the Files filter: no long task over 100 ms on the main thread (`PerformanceObserver` `longtask`), and each keystroke's filter applied within 100 ms |
| `fable-collect.spec.js` | the zip has one folder per file plus `index.xlsx` and `report.csv`; index rows match the queries and modules in each file |
| `fable-variants.spec.js` | drift is grouped by hash ("80 files, 3 versions"); selecting a version shows its diff |
| `fable-inject.spec.js` | replace, add, remove and rename across files; Preview shows `replace` with the old hash; outputs re-open and pass checks; no source handle is ever written |
| `fable-plan-equals-run.spec.js` | for every write recipe, the Preview `sha256` equals the Run `sha256` for every file |
| `fable-cancel.spec.js` | cancel during a 50-file run: within 1 s nothing new is released, no partial file is in the output folder (stubbed directory handle), and no zip is offered |
| `fable-failures.spec.js` | encrypted, `.xlsb`, hostile and too-large files among good ones: the queue completes and the report accounts for every file |
| `fable-batch50.spec.js` | a 50-file batch with every output verified byte-exact against its input except the declared ChangeSet |
| `fable-transform.spec.js` | units, pins, each output mode in Fable's order, chained units |
| `fable-worked-example.spec.js` | Fable §9 exactly: 12 dropped, 2 `.xls` skipped, 10 usable; pins on 3 files; "13 units across 10 files"; 2 rows skipped for a missing column; a zip of 10 workbooks and a 13-row report with 11 changed and 2 skipped; originals untouched |
| `fable-recipes.spec.js` | save, load, a token in use, recipe plus folder dropped together reaching Preview in one action, unknown fields warned, a newer version refused |
| `fable-memory.spec.js` | after a 50-file run plus forced GC (CDP `HeapProfiler.collectGarbage`), main-thread `JSHeapUsedSize` is within 10% of the pre-run baseline; the pool reports 0 in-flight bytes; idle workers hold no workbook |
| `fable-privacy.spec.js` | across a full batch, every request is same-origin and listed in the manifest; storage holds only the allowlisted keys; no IndexedDB; no cookies |

### 7.5 Fixtures

- Add `tests/fixtures/generators/sets.js`. It builds sets **in memory or in a temp folder** from the existing fixtures and generators: copies with renamed sheets, extra sheets, hidden sheets, tables, a missing column, signed VBA, varied query versions (for drift), and refused files. Never commit large generated sets. The lint already skips `workbooks/`, `external/` and `expected/`.
- Fixture provenance goes into `tests/fixtures/workbooks/README.md`, as today.

### 7.6 "Looking right": visual, layout and accessibility

- **Visual baselines.** Add baselines for each new state (empty, indexing, ready, previewing, running, done, done with failures), in both themes, at 1280×800 and at the existing narrow size. Use the same masking rules as decision 19. After generating, **open every new image** and write in PROGRESS.md what is visible in each region. Check specifically that:
  - only the top bar, Files, Recipe, Result and the run bar are visible at rest;
  - **More** is closed;
  - skipped rows aren't coloured like failures;
  - no text is clipped;
  - focus rings are visible.
- **Layout below 1024 px.** Follow decision 18's pattern: the Files region becomes a sheet opened from a button, and selecting a file closes it. Add a narrow-viewport spec.
- **Axe.** Extend `tests/a11y/a11y.spec.js` with every new state and dialog in both themes. There must be zero violations.
- **Keyboard.** Every region is reachable. The Files list and the Result matrix use roving tabindex like the rail (B-10). Every action has a shortcut listed in the `?` sheet. Read `src/app/commands.js` first and pick keys that don't collide.
- **Contrast.** Add every new token pair to `tests/a11y/pairs.json`. The contrast test must pass.
- **Voice.** String tests check that every new message states what happened and what to do next, and that none of the T-LINT-9 banned forms appear.

### 7.7 Real Excel, Firefox and WebKit

- `scripts/make-excel-pack.mjs` (F2-15, extended in F3) writes a folder of outputs, their inputs, and `CHECKLIST.md`. Each item says what to open in real Excel and what to observe. A human runs it. Add results to `docs/observations.md` only when the human reports them.
- F5 adds `firefox` and `webkit` projects to the Playwright config. Fix the failures, or record them as Blocked with the reason.

---

## 8. Phases and tasks

### Phase F0: Set

**Ships:** the new shell, the Files region, folder intake, the worker pool, and today's workspace for a single file.
**Acceptance:** zero feature loss on a single file; existing tests green; a folder indexes without blocking typing.

**F0-01 Baseline and comment sweep**
- Layer: repository.
- Do:
  - On a clean checkout of `beta`, run `npm ci` and `npm test`. Record the pass counts.
  - Re-verify every row of §2 and record any differences.
  - Run T-LINT-1 and strip any comments found (Appendix D).
  - List every code file extension in the repository. If any type isn't covered by T-LINT-1, extend the rule to cover it.
- Test that fails without it: a `lint-rules.test.js` case showing T-LINT-1 flags a comment in each covered extension.
- Acceptance: lint 0, unit green, browser green, baseline numbers in PROGRESS.md.

**F0-02 Fable docs folder**
- Do: create `docs/fable/` with `00_FABLE.md` (Fable verbatim), `01_PLAN.md` (this plan verbatim), and `PROGRESS.md`. Docs are excluded from lint by design.
- Test: `build-manifest.test.js` still passes, and docs aren't added to the service worker manifest.

**F0-03 Layer lint rules**
- Layer: lint.
- Do: add T-LINT-18, -19 and -20 (§7.3). Create empty folders for `src/batch/*` only when a task needs them. The rules pass on an empty tree.
- Test: `lint-rules.test.js` cases for each rule. To make the rules testable, export the rule functions as pure functions over `(relPath, source)`. Change nothing else in `checks.js`.

**F0-04 Protocol module**
- Layer: `src/batch/protocol.js`.
- Do: add message constructors and validators for §5.4, plus `transferListFor(message)`.
- Test: every constructor gives a valid message; an invalid message is rejected; an `applied` message's transfer list contains `result.bytes.buffer`.

**F0-05 File index**
- Layer: `src/batch/index/`.
- Do: `indexWorkbook(bytes, {id, name, relPath, size}) → FileIndex` using `openWorkbook`, plus `refusalFor(error)` and `sha256Text(text)`. Map extension refusals before opening: anything that isn't `.xlsx`, `.xlsm`, `.xltx` or `.xltm` gives `file.unsupportedExtension`, and a name starting with `~$` gives `file.lockFile`.
- Test: every fixture in `tests/fixtures/workbooks` and `external` gets the expected status and counts; the hash is stable.

**F0-06 Worker: open and inspect**
- Layer: `src/workers/m-worker.js`.
- Do: add `open` and `inspect` handlers that read the `File` in the worker, using `src/batch/index`. Change none of the existing handlers.
- Test: a browser test posts a `File` and gets a `FileIndex`. All existing runner, grid and results specs stay green.

**F0-07 Pool**
- Layer: `src/app/pool.js`.
- Do: implement §5.5 with injected dependencies.
- Test: `batch-pool.test.js` with a fake Worker class.

**F0-08 Runner leases from the pool**
- Layer: `src/app/runner.js`.
- Do: `ensure()` takes a leased worker. `stop()` returns it to the pool for replacement.
- Test: all existing runner, cancel, timeout and binding specs pass unchanged. A new unit test checks that terminating the leased worker doesn't affect other pool jobs.

**F0-09 Set session**
- Layer: `src/app/set-session.js`.
- Do: hold the files, per-file badge state (`ready`, `edited`, `skipped`, `failed`), indexes, the current move (`drop`, `choose` or `get`), and the app state (`empty`, `indexing`, `ready`, `previewing`, `running`, `done`, `doneWithFailures`). Emit change events. No DOM.
- Test: a unit test covering state transitions, including the rule that only one move is active at a time.

**F0-10 Intake**
- Layer: `src/app/intake.js` and `src/app/main.js`.
- Do:
  - Handle folder drops through recursive `webkitGetAsEntry` directory reading.
  - Handle multi-file drops and an extra `<input type="file" webkitdirectory multiple>`.
  - Build `relPath` from `fullPath` or `webkitRelativePath`.
  - A single dropped workbook still opens the workspace exactly as today.
  - Two or more files, or a folder, create a set.
- **Changed expectations:** in T-B-16, "two files dropped open nothing" becomes "two files create a set of two", and "a dropped folder is named as a folder" becomes "a folder creates a set". Log both.
- Test: `fable-intake.spec.js`.

**F0-11 Shell skeleton**
- Layer: `src/ui/set/` and `styles/`.
- Do:
  - Add the top bar summary ("12 files · 340 queries").
  - Add the Files list with badges, counts and a filter.
  - Add the empty Recipe and Result regions.
  - Add a run bar showing a count and a bar, with no animation.
  - The empty state reads only "Drop workbooks or a folder." All strings live in `strings.js`.
  - Set `document.title` to include "Fable". If an existing identity or title test fails, log it as a changed expectation.
- Test: an axe test for each state in both themes; keyboard access to every region; new visual baselines reviewed per §7.6; a narrow-layout test.

**F0-12 Single file inside a set**
- Layer: `src/app` and `src/ui/set`.
- Do: selecting a file in the Files list mounts today's workspace in the centre region, with a breadcrumb back to the set. Going back with unsaved edits uses the existing warning. The file-level `edited` marker mirrors `Session.isDirty()`.
- Test: `fable-parity.spec.js` covers every row of Fable §6.1.

**F0-13 Responsiveness**
- Test only: `fable-responsive.spec.js` with 200 generated files.
- Acceptance: no main-thread long task over 100 ms while indexing; the filter keeps up with typing.

**F0-14 Phase F0 gate** (§9).

### Phase F1: Collect and Variants (read only)

**Ships:** batch inventory, export of everything, and the drift view.
**Acceptance:** 500 files indexed; drift grouped by content hash; nothing written.

**F1-01 Recipe model**
- Layer: `src/batch/recipe/`.
- Do: implement Appendix A: parse, validate, serialise and the token list. Nothing in a recipe is ever evaluated.
- Test: `batch-recipe.test.js`.

**F1-02 Resolve: workbook units**
- Layer: `src/batch/resolve/`.
- Do: give Collect one `workbook` unit per ready file. Refused files become report rows with their reason.
- Test: `batch-resolve.test.js` (Collect cases).

**F1-03 Execute: Collect**
- Layer: `src/batch/execute/` and the worker.
- Do: produce per-file query (`.m`) and module (`.bas` or `.cls`) files using `queryFile` and `moduleFile` exactly as today, and transfer the bytes.
- Test: the output equals the single-file "everything as one zip" output for the same workbook, entry for entry.

**F1-04 Collect output**
- Layer: `src/app/outputs.js`.
- Do:
  - Build a zip with one folder per file. The folder name is the sanitised `relPath` without the extension, with `-2` for collisions.
  - Inside each folder, keep the existing ` (n)` rule.
  - Add `index.xlsx` (columns: file, name, kind, load target, hash) through `tablesToXlsx`, which this task introduces with a single sheet. Its output must stay byte-compatible with `tableToXlsx` for one table.
  - Add `report.csv`.
  - Enforce the zip ceiling (Q4).
- Test: `fable-collect.spec.js`.

**F1-05 Result matrix**
- Layer: `src/ui/set/result-matrix.js`.
- Do:
  - Build one table that serves both Preview and the report. Its columns are: file, unit, action, compute, would change or changed, reason, old hash, new hash.
  - Virtualise it above 1,000 rows. Before building new virtualisation, check whether `src/ui/grid.js` can be reused.
  - Use roving tabindex.
  - Skipped rows use the neutral status token.
- Test: an axe test, a keyboard test and a visual baseline.

**F1-06 Variants (drift)**
- Layer: `src/batch/verify/variants.js` and the UI.
- Do: group by query or module name, then by hash. Summaries read like "80 files, 3 versions". Selecting a version shows its diff against the most common version, using the existing `src/core/diff.js` renderer.
- Test: `fable-variants.spec.js`.

**F1-07 Scale**
- Test only: index 500 generated files in Chromium in under 60 s, with the responsiveness criteria from F0-13.

**F1-08 Phase F1 gate.**

### Phase F2: Inject and Replace

**Ships:** batch writes, Preview, verification, the per-unit report, and folder or zip output.
**Acceptance:** a 50-file batch verified byte-exact; cancel leaves no partial file; the queue survives one bad file.

**F2-01 ChangeSet and generalised `selfCheck`**
- Layer: `src/core/save.js`.
- Do:
  - Add `applyChangeSet(wb, changeSet, {now, refreshOnLoad, checkSection})`.
  - `buildWorkbook` becomes a thin wrapper that builds a ChangeSet from `queryEdits` and `vbaEdits`. Its public behaviour and output bytes stay identical.
  - `selfCheck` verifies exactly the declared adds, replaces, renames, removes and sheet writes, and verifies that everything else is byte-identical.
  - Thread `now` through to `writeZip`.
  - Keep T-LINT-12 satisfied.
- Test: `batch-save.test.js`, plus all existing save tests and T-B-06. Single-file downloads must stay byte-identical to `beta` for a fixed `now`.

**F2-02 Execute: replace a query**
- Layer: `src/batch/execute/index.js`.
- Do: `executeFile(wb, filePlan, {now})` → ChangeSet → `applyChangeSet` → `ApplyResult`. This is the only caller of `applyChangeSet` (T-LINT-21).
- Test: `batch-execute.test.js`.

**F2-03 Query add**
- Layer: `src/core/pq/members.js`.
- Do: append a shared section member, add its metadata Formulas item, and make it connection-only. Never create a load target (Q5).
- Test: `batch-pq-members.test.js` (add). The output re-opens with no `pq.countMismatch`, the new query is listed, and `selfCheck` passes. Add an item to the real-Excel pack.

**F2-04 Query remove**
- Do: remove the member and its metadata item. If the query has a connection or load target, **refuse** with `refused: query is loaded`, because a dangling connection would break the workbook.
- Test: unit test.

**F2-05 Query rename**
- Do: rename the member and its metadata item. Refuse if other queries reference the name (A5). Use the existing dependency analysis; *(verify the module behind `tests/unit/wb-deps.test.js`)*.
- Test: unit test.

**F2-06 Module replace across files**
- Layer: execute.
- Do: use the existing VBA writer. `validateModuleText` problems block that row with the line and reason.
- Test: unit and browser tests.

**F2-07 Module add and remove**
- First *verify* whether the VBA writer can change the module list (dir stream, PROJECT stream, CFB directory). If it can't, **stop and ask** whether to build it in this phase or defer it.
- Test (if built): CFB round-trip, re-open, `selfCheck`, and a real-Excel pack item.

**F2-08 Replace in code**
- Layer: execute.
- Do:
  - Support plain text and regex over M and VBA.
  - Regex runs only in the worker, under the per-file time limit. A catastrophic pattern ends that file's job as `failed: m.timeout`, and the queue continues.
  - Preview shows each match as a diff row.
- Test: unit and browser tests, including a pathological regex.

**F2-09 Align**
- Layer: resolve and execute.
- Do: choose a version by hash. Files with the same name and a different hash get `replace`. Files with no query of that name are `skipped`.
- Test: unit and browser tests.

**F2-10 Preview end to end**
- Layer: app, ui, verify.
- Do:
  - Preview is a true dry run. Every row shows its diff using the existing renderer.
  - `replace` rows show the old hash.
  - When a later recipe overrides an earlier one, the Recipe region shows what was replaced.
  - Record each file's `sha256`.
- Test: `fable-inject.spec.js` (Preview parts) and `fable-plan-equals-run.spec.js`.

**F2-11 Get: outputs**
- Layer: `src/app/outputs.js`.
- Do:
  - Folder output uses `showDirectoryPicker`. Write each file with `createWritable()` only after it's verified. On error or cancel, call `abort()`.
  - Zip output is built only from verified outputs at the end.
  - Write `report.csv` both times.
  - Output names follow Appendix C.
  - Assert that no source handle is ever opened for writing.
- Test: `fable-inject.spec.js` (Get parts) with a stubbed directory handle.

**F2-12 Signed VBA confirmation** (**STOP:** confirm Q3 first)
- Do: show one confirmation for the set, naming the count. The report column `signature_removed` is `yes` for those files.
- Test: a browser test using `signed.xlsm` copies.

**F2-13 Cancel and failures**
- Test only: `fable-cancel.spec.js` and `fable-failures.spec.js`.

**F2-14 Fifty-file batch**
- Test only: `fable-batch50.spec.js`.

**F2-15 Real-Excel pack, version 1**
- Do: `scripts/make-excel-pack.mjs` produces outputs for query replace, add, remove and rename, module replace, and signature removal, plus `CHECKLIST.md`. Tell the user the pack is ready. Don't mark anything as verified.

**F2-16 Phase F2 gate.**

### Phase F3: Transform

**Ships:** units, overrides, per-unit runs, and output to a new file, a new sheet, a combined file, then the same sheet.
**Acceptance:** Fable §9 runs end to end; outputs open in real Excel, confirmed by a human using the pack.

Cell writing is the riskiest new core work. Build the output modes in this order, and **do not start the next mode until the human real-Excel check of the previous mode has passed**: new file → new sheet → combined → in place.

**F3-01 Scope resolution** (**STOP:** confirm A3)
- Layer: resolve.
- Do: support whole workbook; all sheets; name pattern (A4); position (first, last, index, index range); type (only tables, only non-empty, only with a header row); and exclude hidden (both `hidden` and `veryHidden`). `nonEmpty` triggers a lazy `inspect`. Pins match by exact name, then by relative path. Report orphan pins. Divergence is stated as fact: "7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files."
- Test: `batch-resolve.test.js`, including the 16 ms budget.

**F3-02 Precedence**
- Test only: a unit test for every rule in Fable §3.3.

**F3-03 Units in the engine and tokens** (**STOP:** confirm A2)
- Layer: execute and core snapshot.
- Do: extend the run snapshot with the unit as A2 describes. Substitute tokens as raw text before the parse check. A parse failure becomes a row error showing the substituted M.
- Test: unit tests with a sheet unit, a table unit, and an unknown token.

**F3-04 Chained units**
- Do: units run in index order inside a file. A unit may read an earlier unit's output by its output name. Nothing is shared across files.
- Test: unit test.

**F3-05 Output: new file per unit** (**STOP:** confirm A1)
- Do: use `tablesToXlsx` (one sheet). Names follow `{file.name}__{unit.name}.xlsx` with `-2` for collisions.
- Test: browser test and a real-Excel pack item. **Wait for the human check.**

**F3-06 Output: new sheet**
- Layer: `src/core/sheet/`.
- Do:
  - Add a worksheet part using inline strings, so shared strings are never touched.
  - Add a content-type override, a workbook rel with a fresh `rId`, and a `<sheet>` **appended last** so `definedNames localSheetId` values stay valid, with a unique `sheetId`.
  - Splice-append any `cellXfs` the date styles need.
  - Update `docProps/app.xml` titles only if *verification* against fixtures shows Excel keeps them consistent; otherwise leave the file untouched and record the decision.
  - `selfCheck` verifies the added parts.
- Test: `batch-sheet.test.js`, a browser test, and a real-Excel pack item. **Wait for the human check.**

**F3-07 Output: combined**
- Do: `tablesToXlsx` with many sheets, using the same naming rules.
- Test: unit test and a pack item. **Wait for the human check.**

**F3-08 Output: in place**
- Do: opt-in and labelled. Each unit writes its range in the output copy. Overlapping ranges are a planning error caught in Preview. A target range that overlaps any table is refused. Cells are replaced through XML splices.
- Test: unit and browser tests and a pack item.

**F3-09 Compute: Excel runs it on open** (**STOP:** confirm Q5)
- Do: inject the M and set `refreshOnLoad` on an existing load target only. Otherwise the row states the reason and offers *Quoin runs it now*. Show the compute mode on every row.
- Test: browser test and a pack item.

**F3-10 Worked example**
- Test only: `fable-worked-example.spec.js`, with every number from Fable §9 asserted.

**F3-11 Phase F3 gate.**

### Phase F4: Recipes

**F4-01 Save and load recipe files**
- Do: download as `{name}.quoin-recipe.json` and load by drop or picker. Cap size at 256 KB. The serialiser refuses binary or typed-array values.
- Test: `fable-recipes.spec.js` (part).

**F4-02 Recipe plus folder in one action**
- Do: dropping a recipe and a folder together goes straight to Preview.
- Test: browser test.

**F4-03 Stored recipes and recent sets**
- Do: store saved recipes under `quoin.recipes` and recent set **names** (never paths or contents) under `quoin.recent`.
- **Changed expectations:** T-LINT-8 becomes an exact three-key allowlist, and T-PRIV-3 expects exactly those keys after use. Update the README Privacy section in the same task.
- Test: `fable-privacy.spec.js`.

**F4-04 Token editing**
- Do: tokens are offered in the Recipe region. Unknown tokens are flagged in Preview.
- Test: browser test and axe.

**F4-05 Phase F4 gate.**

### Phase F5: Trust

**F5-01 Firefox and WebKit:** add Playwright projects. Fix failures or record them as Blocked with reasons. Don't use browser-specific workarounds that sniff the user agent; detect features instead (decision 21's habit).

**F5-02 Large-set performance:** measure index time, Inject throughput, the largest responsive folder and the memory ceiling. Publish the results in `docs/fable/performance.md`, and adjust the Q4 numbers only with evidence.

**F5-03 Memory:** `fable-memory.spec.js` must pass.

**F5-04 Real-Excel closure:** compile the complete pack. Once the human reports results, update `docs/observations.md` and the README's "has not been run against real Excel" text only as far as the results justify.

**F5-05 README and decisions:** document features, entry paths, storage keys and limits. Add a `docs/decisions.md` entry for every deviation.

**F5-06 Final gate** (§9 and §10).

---

## 9. Phase gates

A phase is done only when every box is ticked in PROGRESS.md with evidence: a command output summary, a spec name or a screenshot path.

**Every phase:**
- [ ] `npm test` is green. Lint shows **0** findings, including **T-LINT-1: no comments anywhere**.
- [ ] Every new test was shown to fail without its change.
- [ ] No existing test was weakened, skipped or deleted. Every changed expectation is logged with its reason.
- [ ] Every new surface has a keyboard path, axe checks in both themes, contrast pairs and reviewed visual baselines.
- [ ] No new dependency, no network call, no new storage key outside the allowlist, no base64 or binary data persisted.
- [ ] The phase's vertical slice (drop → choose → preview → get) works by hand in Chromium.
- [ ] README, `docs/decisions.md` and PROGRESS.md are updated.

**F0:** the parity spec covers every row of Fable §6.1. Folder intake works. The responsiveness spec passes. A single-file drop behaves exactly as in `beta`.
**F1:** 500 files indexed in under 60 s. The Collect zip is correct. Drift is grouped by hash. No write API was called.
**F2:** the 50-file batch is byte-exact. Plan equals run. Cancel leaves no partial file. The queue survives bad files. The real-Excel pack v1 has been handed to the user.
**F3:** the worked example passes. Each output mode passed its human real-Excel check before the next one started.
**F4:** a recipe plus a folder reaches Preview in one action. The storage allowlist is updated with the README.
**F5:** Firefox and WebKit are run. Performance is published. The memory test passes. The real-Excel list is closed as far as human results allow.

---

## 10. Definition of done for Fable

This repeats Fable §15. Every item needs evidence.

- A batch of 50 files with mixed sheets, one scope rule and three pins: Preview is correct before running.
- Every output opens in real Excel (human-verified).
- Every output verifies against its input.
- The report accounts for all 50 files and every unit.
- Cancel leaves no partial file.
- Memory returns to baseline.
- A single file still does everything it did in `beta`.
- The repository contains no code comments, and T-LINT-1 is green.

---

## 11. Stop and ask

Stop, write the question in PROGRESS.md under *Blocked*, and ask the user before doing any of these:

1. Any **STOP** item in §4 (Q3, Q5, A1, A2, A3) before its named task.
2. Adding or upgrading any dependency, including dev dependencies.
3. Changing an existing test expectation that no task card names.
4. Any change that would alter single-file download bytes for a fixed `now`.
5. Weakening or bypassing `selfCheck`, T-LINT-12, the CSP, or any lint rule.
6. Finding that a §2 fact is wrong in a way that changes a task's scope, such as F2-07's VBA writer capability.
7. Any feature in Fable §12 "Not doing", or any feature not in Fable.
8. Any need to persist something not listed in §7 of Fable.
9. Any doubt about whether text is a code comment or data (Appendix D).
10. Two consecutive attempts that fail the same test for reasons you can't explain.

---

## 12. Appendices

### Appendix A: Recipe file, version 1

The recipe file is plain JSON, small and diffable. Nothing in it is evaluated. Unknown fields produce a warning and are ignored. If `v` is greater than the supported version, the recipe is refused with `recipe.newer`.

```json
{
  "recipe": "collect | inject | replace | transform | align",
  "v": 1,
  "name": "optional display name",
  "scope": {
    "type": "workbook | sheets | tables",
    "match": "all | pattern | position",
    "pattern": "Data*",
    "patternKind": "glob | regex",
    "position": { "kind": "first | last | index | range", "index": 1, "from": 1, "to": 3 },
    "onlyNonEmpty": false,
    "onlyWithHeader": false,
    "excludeHidden": true,
    "exclude": ["Notes"]
  },
  "overrides": [ { "file": "2024-sales.xlsx", "path": "east/2024-sales.xlsx", "units": ["Data"] } ],
  "inject":   { "target": "query | module", "op": "add | replace | rename | remove", "match": "name | pattern", "name": "CleanSales", "newName": null, "source": "inline", "text": "let … in …", "refreshOnLoad": true },
  "replace":  { "in": ["m", "vba"], "find": "srv-old", "with": "srv-new", "kind": "text | regex", "matchCase": true },
  "query":    { "source": "inline", "m": "let … in …" },
  "align":    { "target": "query | module", "name": "CleanSales", "hash": "full sha256" },
  "output":   { "mode": "newFile | newSheet | combined | inPlace", "name": "{file.name}__{unit.name}.xlsx", "range": null },
  "compute":  "quoin | excel",
  "more":     { "culture": "en-US", "limits": { "timeoutMs": 30000, "maxRows": 1000000 }, "encoding": "utf-8", "csvGuard": true }
}
```

- Only the block that matches `recipe` is read. Other blocks give an `ignored` warning.
- The tokens are exactly `{file.name}` (base name without extension), `{file.folder}` (folder-relative path, `""` at the root), `{unit.name}` and `{unit.index}` (1-based). Any other `{…}` is a planning error with the code `recipe.token`.

### Appendix B: Report rows and CSV columns, in this order

`run_id, file, folder, unit, unit_index, recipe, action, compute, verdict, reason_code, reason, old_hash, new_hash, output, verified, signature_removed, duration_ms`

- `verdict` ∈ `changed | unchanged | skipped | refused | failed | cancelled | not-released`.
- `skipped` is a normal outcome (`skip.noMatchingUnit`, `skip.missingColumn`, `skip.notApplicable`). It's rendered with the neutral status token, never the failure token.
- CSV is written with the existing `tableToDelimited` with the formula-injection guard on and a UTF-8 BOM, because the report opens in Excel.
- Every dropped file appears in the report at least once, including refused files (`unit` empty, `verdict=refused`).

### Appendix C: Naming rules

- **Excel sheet names:** 1 to 31 characters. None of `: \ / ? * [ ]`. No leading or trailing `'`. Not `History`. Unique case-insensitively within the workbook. On collision, append `-2`, `-3` and so on, truncating the base name so the result fits in 31 characters, counted by code point.
- **Output file names:** use the existing `sanitizeFileName` (code-point truncation, trailing dots and spaces removed, reserved device names prefixed). On collision (case-insensitive), insert `-2` before the extension. Never overwrite.
- **Collect folders:** the sanitised `relPath` without the extension; `-2` on collision. Inside a folder, keep the existing ` (n)` rule from `zipFiles`.

### Appendix D: Comment stripping procedure

1. Run `npm run test:lint` and collect the T-LINT-1 findings.
2. For JS and MJS files, parse with acorn (already a dev dependency) using `onComment` to get exact comment ranges. Remove each range. If the comment occupied a whole line, remove that line as well. Never change anything else.
3. For CSS, remove `/* … */` blocks. For HTML and SVG, remove `<!-- … -->` blocks.
4. **Do not touch** string literals, template literals, regex literals, M or VBA text inside strings, fixture files, Markdown or the hashbang.
5. Re-run the full suite. Every result must be unchanged except T-LINT-1, which must go to 0.
6. Record the files changed in PROGRESS.md.

### Appendix E: Strings and error codes to add (indicative)

Every string goes into `src/ui/strings.js`. Every code goes into `ERRORS`. Each message states what happened and what to do next.

| Code | Message |
|---|---|
| `file.unsupportedExtension` | "Skipped. Quoin opens .xlsx, .xlsm, .xltx and .xltm files." |
| `file.lockFile` | "Skipped. This is an Excel lock file." |
| `skip.noMatchingUnit` | "No matching sheet." |
| `skip.missingColumn` | "The query names a column this sheet does not have: {column}." |
| `refused.referenced` | "Not renamed. Referenced by {names}." |
| `refused.loaded` | "Not removed. This query loads to {target}." |
| `recipe.newer` | "This recipe is from a newer version of Quoin and was not opened." |
| `recipe.token` | "Unknown token {token}." |
| `verify.planDrift` | "Not released. The output differs from its preview. Report this file." |
| `output.zipTooLarge` | "These outputs exceed what one zip can hold. Choose a folder or fewer files." |
| `pool.cancelled` | "Cancelled. No output was written for this file." |

Empty state: "Drop workbooks or a folder." Use no other tutorial text anywhere.

---

**Reminder for every task:** never add a code comment, and strip any you find. Write the test first and prove it fails without the change. Plan and run share one function. Release nothing unverified. Never touch an original. One bad file never stops the batch.
