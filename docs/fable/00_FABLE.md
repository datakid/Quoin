# Quoin — *Fable*

**The next version of Quoin. Direction, architecture, shell, roadmap.**

**To Opus:** this is a decision document, not a wish list. Turn it into an implementation plan for Sonnet, phase by phase. Do not re-open anything marked **Decided** — those are settled and argued below. Check anything marked *(verify)* against `src/` and `docs/decisions.md` before planning on it. Its only basis is the `beta` branch README; no source was read. Where this document and the code disagree, the code wins and you say so.

---

## 0. One line

Do to a whole folder what Quoin does to one workbook: **Drop, Choose, Get.**

Today Quoin opens one workbook and lets you read, edit, run and export its Power Query and VBA. Fable applies the same power to twelve files or twelve hundred, and makes the safe path the easy path.

## 1. Rebuild or evolve — Decided: evolve

Keep `src/core` (zip, xml, opc, cfb, ovba, DataMashup, M engine, exports, diff). Its byte-exact writes and its read-back check are what make batch work safe; they are also the hardest thing in the project, and they already exist. Rebuild the shell around a *set* of files instead of one.

Nothing is lost. A single dropped file still opens the workspace that exists today — editor, grid, compare, export, print, shortcuts — with a way back to the set. Constraints carried forward: no runtime dependencies, no network after load, no accounts, no analytics, tokens-only CSS, self-hosted fonts.

The name: **Fable** is the working name of this version, not necessarily of the product. Leave the shipped wordmark alone; use the name in docs and window titles only.

## 2. The nouns

**Files** · **Recipe** · **Preview** · **Result**. One file is a set of one. The interface never needs a fifth noun.

Three moves, and the app can only be in one of them:

1. **Drop** — a folder, some files, or a recipe file. Index them.
2. **Choose** — pick a recipe, set its scope, see what it resolves to.
3. **Get** — Preview, then New files (a folder or a zip), then the report.

## 3. Batch semantics — the part to get right

Never think *"apply a query to a file"*. Always:

> **plan = resolve(recipe, set)** → **run(plan)** → **report(plan)**

A **unit** is the atomic thing a recipe acts on: a sheet, a table, or the workbook itself (for code recipes). Resolution is pure, deterministic and inspectable.

### 3.1 Two layers, always

1. **Scope rule** — written once, resolves independently in each file:
   whole workbook · all sheets · sheets matching a name pattern · by position (first, last, index, index range) · by type (only tables, only non-empty, only those with a header row) · exclude hidden.
2. **Overrides** — per-file pins, written only for exceptions.

The canonical case: the rule is *all sheets*, and the three files that need something else are pinned to `Data`. The rule is the default, the pin wins, and both are visible in one table. Deliberately **not** one clever rule that encodes the exceptions: that rule would be unreadable, and it would break silently the day a file gains a sheet.

### 3.2 Resolution rules

- Pins are matched to files by name, and survive a rename by being stored as a rule, not an index *(design choice for Sonnet: exact name first, then folder-relative path)*.
- A pin whose file is absent from the set is shown as orphaned and never silently dropped.
- A file resolving to nothing is `skipped: no matching sheet` — a normal outcome, not an error, and not coloured like a failure.
- Divergence is normal: *"3 files → 2 sheets, 9 files → 1 sheet"*. Preview states it as a fact, not a warning.
- **Order inside a file is the unit order**, and a unit may read a prior unit's output (chained transforms). Across files nothing is shared; a recipe that would need cross-file state is out of scope, not worked around.

### 3.3 Precedence when things collide

- A pin always beats the scope rule.
- An explicit exclude beats an include.
- Two recipes on the same field of the same file: last chosen wins, and the recipe region shows what it replaced rather than stacking invisibly.
- Injecting a name that already exists is `replace`, never a duplicate — stated in Preview as `replace`, with the old hash.

### 3.4 Fan-out — one unit, one output

- **New file per unit:** `{file}__{unit}.xlsx`. Extensions preserved. Collisions suffixed `-2`, never overwritten.
- **New sheet:** one sheet per unit, named from file and unit, sanitised to Excel's own restrictions, collisions suffixed.
- **Combined:** one output workbook, one sheet per unit, same naming.
- **In place:** each unit writes its own range; overlapping ranges are a planning error caught in Preview, not at write time.
- **Report rows are per unit**, so 40 files × 3 sheets is 120 rows, each with its own verdict.

### 3.5 The recipes

| Recipe | Does | Needs |
|---|---|---|
| **Collect** | Pull every query and module from every file into a zip, one folder per file, with an index sheet (file, name, kind, load target, hash) | read only |
| **Inject** | Add, replace, rename or remove a query or VBA module across files, matched by name or pattern | splice writer |
| **Replace in code** | Find and replace across M and VBA — a moved server, a renamed path, a changed column. Plain text and regex. | splice writer |
| **Transform** | Run a query against a unit; output to new file, new sheet, combined file, or in place | cell writer + engine |
| **Align** | Make every copy of a query match one chosen version | splice writer + hashes |

Recipes take **tokens** — `{file.name}`, `{file.folder}`, `{unit.name}`, `{unit.index}` — so one query adapts per file. A recipe saves as a small text file; drop a recipe and a folder together and go straight to Preview.

Every write recipe offers two ways to compute, and the choice is visible in Preview on every row:

- **Quoin runs it now** — the result is written as values. Bounded by the M engine's coverage (511 full, 2 partial, 32 unsupported library entries) and by run limits.
- **Excel runs it on open** — the M is injected with a load target and refresh-on-open. Slower for the user, unlimited by our engine, and the honest default for anything the engine only partly covers.

## 4. Architecture — Decided layering

A layer is a folder, not necessarily a "module". Purity is what keeps batch work testable.

| Layer | Purity | Thread | Job |
|---|---|---|---|
| `recipe` | pure data | any | serialisable description, no code |
| `resolve` | pure | main | recipe + file index → plan |
| `execute` | pure, per file | worker | workbook + plan → new bytes + change list |
| `verify` | pure | worker | read own output back: every edit, every untouched part |
| `session` | stateful | main | set, plan, progress, report — the single source of truth |
| `shell` | DOM only | main | render and input; holds no business state |

`resolve` stays on the main thread: it reads a lightweight index and must keep up with typing. `execute` and `verify` never touch the DOM.

### 4.1 Workers — Decided: one pool, one entry, one protocol

The existing M worker *(verify)* becomes one message type:

```
open(fileRef)          → fileIndex | refused{reason}
inspect(fileRef)       → sheets, queries, modules, hashes
apply(fileRef, plan)   → {bytes, changes[], warnings[]}
cancel(fileRef | all)
progress               ← {fileId, unitId, phase, pct}
```

One pool, not several. `core` is dependency-free pure functions; separate pools would just compete for the same cores, and a single file's pipeline should not hop between workers.

- Pool size `min(4, max(1, hardwareConcurrency - 1))`, lowered on device memory hints, and **capped by a byte budget on inflated bytes in flight** rather than file count — so one 200 MB workbook *(verify limit)* still works at pool size 1.
- **A job is one file with all its units.** One open, one write, one verify. Never a job per unit: that would reopen the same workbook three times and triple the wall clock.
- Buffers move as **transferables** (ArrayBuffer). Never copies, never base64, never a string round trip.
- Cancel is a flag checked between units, with terminate as the last resort. Per-file and per-run limits mirror the engine's existing time and row caps *(verify)*.
- One file failing is reported and **the queue continues**. A batch never stops because file 7 is password-protected.

## 5. Native JS — Decided: agree, no WASM

The heavy work is already native: `DecompressionStream` for zip, string and byte splices for XML, an evaluator over JS values. WASM means rewriting the core and losing the byte-splice guarantee, for gains the profile does not show. The real wins are structural, and they are the work:

- keep a read-only index per workbook (part names, hashes, locations of queries) instead of re-parsing for every unit;
- transfer buffers, never clone; never base64;
- inflate only the parts a recipe touches; copy untouched parts as their original compressed bytes — already the design;
- profile parse, inflate and M evaluation before optimising any of them.

WASM is a later option only if measurement names compression or scanning as the bottleneck, and not before Phase 3. It is not budgeted.

## 6. Shell

One screen, three regions read left to right, and one run bar. Nothing else on screen at rest.

- **Top bar** — name, set summary ("12 files · 340 queries"), theme, shortcuts. One primary action.
- **Left: Files** — list or tree, per-file badge (ready, edited, skipped, failed), unit and query counts, filter.
- **Centre: Recipe** — the five recipes as a compact chooser, its parameters, then a single **More** for advanced controls (regex, culture, limits, load target, encoding, formula-injection guard). A single dropped file turns this region into today's workspace, with a way back to the set.
- **Right: Result** — the Preview matrix first, the report after a run. The same table, one column swapping from "would change" to "changed". This sameness is the point: the user learns one table.
- **Run bar** — resolved unit count, progress, cancel. A count and a bar, no animation.
- **States** — empty → indexing → ready → previewing → running → done / done with failures. Empty state is the only tutorial: *"Drop workbooks or a folder."*
- **Tokens** — surface levels, ink levels, one muted accent, desaturated status, generous radius, soft elevation, large hit targets, one type scale. Keep Atkinson Hyperlegible Next and Commit Mono.
- **Voice** — quiet. Labels are nouns and verbs. Messages state what happened and what to do next. No greetings, tips, tours, emoji or exclamation marks. No assistant, no chat.
- **Keyboard throughout**; the axe-core checks extend to every new surface.

The organizing principle: **the advanced controls are always in the same place and always closed.** A beginner never meets them; an expert opens one disclosure and finds everything.

### 6.1 Where today's features live — no feature loss

Phase 0 acceptance is zero feature loss, so every current capability has a home. None of these is rebuilt; each is reached one click further in.

| Today | In Fable |
|---|---|
| File details (format, size, counts) | The file's header inside the centre region |
| Query list with ƒ badge and load target | Centre region, list mode, unchanged |
| Module list (standard, class, workbook, sheet) | Centre region, list mode, unchanged |
| M/VBA editor with line numbers and find | Centre region, editor mode, add only a breadcrumb back to the set |
| Edited marker, revert one, revert all | Unchanged, plus the same marker at file level in the Files list |
| *Review changes* unified diff | Unchanged; the same diff renderer powers a Preview row |
| Run query, step list, grid, drill-down, copy names | Unchanged |
| Compare against Excel's last load, difference list | Unchanged; in batch it becomes one column of the report |
| Export result (CSV, TSV, JSON, xlsx) and code (m, bas, cls, zip) | Unchanged; **Collect** is the same export applied to a set |
| Print preview and print | Unchanged, single file only — printing a batch is out of scope for this version |
| Keyboard shortcuts and the `?` sheet | Unchanged, extended with set-level actions |
| Theme, offline, installable | Unchanged |
| Download with write-through file picker and read-back check | Becomes the output step for one file and for a folder in |

If a row in this table cannot be reached after Phase 0, Phase 0 is not finished.

## 7. Data safety

- Originals are never modified on disk. Output goes to a new folder or a zip; in-place is opt-in and labelled as such.
- **Preview is a true dry run** — it produces real bytes in memory and discards them, so what it says is what happens.
- Every output file is verified against its input before it is offered: every edit present, every untouched part byte-identical. If verification fails, that file is not released and is reported.
- Partial failure never leaves a half-written file. A unit either lands or does not.
- Signed VBA loses its signature on edit: one confirmation for the set, naming the count, and the report marks those files *(confirm with Opus — open question 3)*.
- Report exports as CSV. The report is the receipt; it is never hidden behind a toast.
- **What is stored:** the theme, the recent set names, and saved recipes — all small text under `quoin.*` keys in local storage. Workbook bytes, indexes and results are never persisted. No IndexedDB, no cache of user files, no cookies *(verify against the service worker's current cache rules)*.

## 8. Recipe file — sketch

Small, plain, diffable, no code evaluation:

```json
{ "recipe": "transform", "v": 1,
  "scope": { "type": "sheets", "match": "all", "excludeHidden": true },
  "overrides": [ { "file": "2024-sales.xlsx", "units": ["Data"] } ],
  "query": { "source": "inline", "m": "let ... in ..." },
  "output": { "mode": "newFile", "name": "{file.name}__{unit.name}.xlsx" },
  "compute": "quoin" }
```

Unknown fields are ignored with a warning, never fatal. A recipe from a newer version is refused, not guessed at.

## 9. Worked example — the case this version exists for

Twelve workbooks are dropped; two are `.xls` and cannot be opened, leaving ten. Seven should get `CleanSales` on their `Data` sheet only, into a new sheet called `Clean`; three should get it on all of their sheets (two each).

1. **Drop.** Twelve rows, two marked `skipped: not .xlsx/.xlsm` with the reason, ten usable.
2. **Choose.** *Transform*. Scope: *all sheets*. Output: *new sheet, `Clean`*. Compute: *Quoin runs it now*.
3. **Pin.** Three overrides, `Data` only. Preview states *"7 files → 1 unit each, 3 files → 2 units each — 13 units across 10 files."*
4. **Preview.** 13 rows. Two warn that the query names a column their sheet does not have; those two rows are excluded and their files fall back to *inject only*, which is shown rather than silently dropped.
5. **Get.** A zip of 10 workbooks and a 13-row report — 11 changed, 2 skipped with reasons. Originals untouched, every output verified against its input.

No naming conventions were invented, nothing was inferred silently, and the exceptional files are visible as exceptions rather than as a rule nobody can read.

## 10. Roadmap

| Phase | Ships | Acceptance |
|---|---|---|
| **0. Set** | New shell, Files region, folder in, worker pool, today's workspace for a single file | Zero feature loss on a single file; existing tests green; a folder indexes without blocking typing |
| **1. Collect + Variants** | Batch inventory, export all, drift view ("80 files, 3 versions") | 500 files indexed; drift grouped by content hash; read-only, so nothing is written |
| **2. Inject + Replace** | Batch write, Preview, verify, per-unit report, folder or zip out | 50-file batch verified byte-exact; cancel leaves no partial file; queue survives one bad file |
| **3. Transform** | Units, overrides, per-unit run, new file, new sheet, then same sheet | The worked example in §9 runs end to end; outputs open in real Excel |
| **4. Recipes** | Save, load, tokens, recipe plus folder | A dropped recipe and folder reaches Preview in one action |
| **5. Trust** | Real Excel checks, Firefox and WebKit, large-set performance | The README's "not been run against real Excel" list is closed |

Writing cells is the riskiest new core work — worksheet part, relationships, content types, shared strings, and any table overlapping the target range. Order it **new file → new sheet → combined → in place**, and prove each against real Excel before the next. Testing output in real Excel starts during Phase 2, not after it: batch multiplies any write bug by the file count. Note that `Excel.CurrentWorkbook` exposes tables and named ranges, not sheets, so the "Excel runs it on open" path needs a load target that already exists or is created *(open question 5)*.

## 11. Performance targets

- Index: 500 files, under a minute, UI responsive throughout.
- Inject: a small file per second per worker, measured and published.
- Transform: bounded by the engine, not by the shell; every run cancellable within a second.
- Memory: returns to baseline after a run; a set never holds more than one inflated workbook per worker.
- No binary snapshots or base64 in any persisted state.

## 12. Not doing

Running VBA. Cloud, accounts or sync. `.xls`, `.xlsb`, password-protected files. The data model. An assistant or chat. Network connectors. Cross-file state in a recipe. WASM (see §5).

## 13. Open questions for Opus

1. How much of `src/app` survives the move from one session to a set? *(verify)*
2. Does the existing `.xlsx` result export give a head start on the cell writer? *(verify)*
3. Signed VBA: one confirmation per set, or per file?
4. Memory ceiling for a set, and what the interface says when it is hit?
5. Can "Excel runs it on open" create a new load target safely, or only reuse one?
6. Files per minute for Inject, and the largest folder that stays responsive — set the targets, then measure them.

## 14. Risks

| Risk | Mitigation |
|---|---|
| A write bug multiplied by 80 files | Verify every output before release; real-Excel checks from Phase 2; in-place last and opt-in |
| Scope rules that surprise people | Plan is inspectable before any run; pins visible; nothing inferred silently |
| Memory blow-up on large sets | Byte budget on in-flight work, one workbook per worker, streaming outputs to disk or zip |
| Shell rebuild loses the single-file experience | Phase 0 acceptance is explicitly zero feature loss |
| The M engine's gaps surface only in batch | Two compute modes on every row; "Excel runs it on open" is a first-class path, not a fallback |

## 15. Definition of done

A batch of 50 files with mixed sheets, one scope rule and three pins: Preview is correct before running; every output opens in real Excel; every output verifies against its input; the report accounts for all 50 files and every unit; cancel leaves no partial file; memory returns to baseline; a single file still does everything it did in `beta`.

---

## Appendix — notes for the plan

Four directives for how to slice the work. They are decisions, not suggestions.

1. **Vertical slices, not layers.** Each phase ships a complete path — drop → choose → preview → get — rather than "all of resolve, then all of execute". A phase that cannot be used is not done.
2. **One unit of work per Sonnet task.** A task touches one layer, one recipe, or one phase of the pipeline, and ends with a test that would fail without it. If a task needs the words "and also", split it.
3. **The plan and the run share one function.** Whatever produces Preview bytes produces the output. If they ever diverge, the plan has a bug — treat that as the highest-severity defect class in the project.
4. **Every new surface gets its keyboard path and its axe check in the same task**, not in a later cleanup. This is already the project's standard; keep it.

Where this document is silent, prefer the smaller thing that matches the existing code's habits. Where it is explicit, do not improve on it without saying why to the user first.
