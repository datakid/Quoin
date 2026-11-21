# quoin vNext progress

## Phase 0 — Baseline and hygiene

### Done
- Baseline on a clean checkout of main: lint failed with 2 findings (T-LINT-1 comments in vendor/jszip.min.js and vendor/xlsx.full.min.js); unit and browser suites not reached.
- H-1 (from 00_START_HERE.md only; 01_AUDIT.md was not available): removed js/ and vendor/ (no references anywhere in src, styles, index.html, sw.js, scripts or tests) and the unused fonts fraunces-italic, instrument-sans, jetbrains-mono from public/fonts.
- npm run build: 89 files, none of the removed paths listed.
- Suite after H-1: lint 0 findings, unit green, browser 46 passed.

### Changed expectations
- None.

### Not reproduced
- First full run after H-1 showed 7 browser failures (T-PERF-3 and six privacy tests failing on page.goto to localhost:5173). Each passes alone and a second full run was fully green, so this was a transient dev-server failure after the 1,000,000-row perf test, not caused by H-1.

### Blocked
- Phases 1 to 5 need 01_AUDIT.md, 02_IDENTITY.md, 03_EDIT_RUN_SAVE.md, 04_PRINT.md and 05_TEST_PLAN.md. Only 00_START_HERE.md and the identity assets (favicon.svg, mark.svg, icon-maskable.svg, preview.html, preview.css) were supplied.

### Deviations
- None.

## Phase 1 — Correctness fixes

### Done
- Identity choice: the ring-and-block mark from `assets/` (the `_1` set) is the one to ship in Phase 2.
- H-1 follow-up: T-LINT-11 (every font file is referenced by an @font-face).
- B-01 extension chosen from the format first (`xltm` stays `xltm`), single `src/core/filename.js` shared by `Session.suggestedName` and `save.js`. B-02 file names truncate by code point, drop trailing dots and spaces, prefix reserved device names.
- B-03 one `normalizeQueryText` in `src/core/pq/section.js`; decision 15 in `docs/decisions.md`.
- B-04 T-B-04 (tampered workbook makes the save reject with no bytes) and T-LINT-12 (selfCheck defined in `save.js` only, never inside a try whose catch does not rethrow).
- B-05 unload guard registered only while dirty; service worker no longer calls `skipWaiting`.
- B-06 T-B-06 over every fixture: untouched entries identical as compressed bytes, second save byte-identical.
- B-07 `h()` emits `"false"` and `"true"` for `aria-*`, `contenteditable`, `draggable`, `spellcheck`. Export and Download triggers now carry `aria-expanded` (B-13).
- B-09 main-thread stop at timeout plus 2 s grace, reported as `stopped` / `m.timeout`; the timer pauses while a binding dialog is open.
- B-10 rail built once, roving tabindex, Up/Down/Home/End move selection and focus, type-ahead; edited dot updated in place.
- B-11 sorting disabled with a reason above 200,000 rows (`aria-disabled` plus a note in the menu); Ctrl+Home/End, Enter on error and nested cells, `aria-selected` on selected cells.
- B-12 ligatures and kerning off on the shared text layers; find count announced once after 300 ms.
- B-13 menus and popovers flip inside the viewport, return focus to the trigger (also after an outside click), top layer only handles Escape.
- B-14 dialogs restore focus to a connected opener; Run and Cancel swap keeps focus on a visible button (`setRunning`).
- B-15 `#status` (polite, throttled to one update per 500 ms, no duplicates) and `#alert` (errors) inside `.statusbar`; an identical note sent twice is announced twice.
- B-16 drag counter, one-file rule, folder and unsupported-type messages (alert region when a session is open), drops outside the zone are prevented.
- B-17 theme-init catch is a no-op; T-LINT-13 compares both `theme-color` metas and the manifest colours with the body background token; manifest `theme_color` now equals the ground colour.
- B-18 `src/ui/formats.js` (`formatsFor`) used by the status strip, the grid and the row-cap message; a culture change re-renders the grid without a re-run.
- B-19 grid labels and glyphs in `strings.js`; T-LINT-9 now also checks `text:` properties and `*Label`/`*Text`/`*Display` functions.
- B-20 `sw.js` is part of the version hash and is not pre-cached.
- B-21 contrast checker lives in `tests/unit/contrast-lib.js` and reports missing, uncovered and non-hex tokens; `pairs.json` has an `exempt` map with reasons.
- B-24 T-LINT-14 keeps all four CSP copies identical.

### Changed expectations
- None. `.statusbar` now contains `#status` and `#alert`; existing tests read the container text and still pass.

### Not reproduced (the audit's claim did not match the code)
- B-04 as a bypass: no flag or path skips `selfCheck`; `faultInject` throws before it. T-B-04b is the existing T-E2E-19.
- B-08 stuck `runId` after a worker crash: the run handler receives a synthetic `result` and clears it (T-B-08 passes on the old code). A neighbouring defect was real and is fixed: `rows()` resolved `undefined` after a crash.
- B-10 scroll reset on selection (T-B-10 scroll test passes on the old code). Focus loss and the missing tab stop were real.
- B-12 overlay drift at line 1,500: the overlay is translated from the textarea scroll position, so it cannot drift; the test passes on the old code.
- B-14 focus loss in native dialogs: the browser restores it. The real loss was the hidden Run button.
- B-17 mismatch between `theme-color` and `--paper`: they were equal; they diverge only once I-1 renames the palette, which T-LINT-13 now catches.
- B-22 claim that `inner` is unused: it is used for the 512 maskable icon.
- B-23 offline reload with a query string works already (`ignoreSearch`); the test stays as a guard. A 504 fallback was not added.

### Blocked
- B-22 (icon script) is moved into I-14: it needs `public/icon-maskable.svg` from I-13, and both rewrite `scripts/make-icons.mjs`. T-B-22 is added there.

### Deviations
- B-01 and B-02 share one commit because they share the new module.
- B-07: nothing in the app passed a boolean to `h()` for these attributes, so there was no visible symptom; fixed at the helper.
- B-09: the terminal state is `{ status: 'stopped', code: 'm.timeout' }` so the existing message path is reused.
- B-11: PageUp and PageDown keep the viewport-sized step instead of the audit's fixed 200 rows. T-B-11 uses a 300,000-row query built in the test.
- B-16: `.xls`, `.xlsb` and `.ods` go through the content check so their specific messages survive; only other extensions get the type message.
- B-18: no date formatter was added; nothing formats dates. The grid keeps grouping off for cells by design, so the test asserts the decimal comma for cells and the thousands dot for counts.
- B-24: `frame-ancestors` stays out of the meta policy because browsers ignore it there and log an error; the lint requires the header copies to match each other and the meta to match them minus that directive.
- E-1 refers to `isDirty()`; the session exposes `editCount`. Phase 3 will add `changes()` on top.
- The plan quotes token names that differ from the code (`--t-xs` is split from `--t-xs-lh`, `--hit`, `--r-sm`, Commit Mono as `--font-code`, `--scrim` already exists). Phase 2 maps the old names to the new ones instead of copying the plan's block verbatim.

### Observations for Phase 2
- At 390 px wide the top bar overflows (Download is clipped), the Code/Result switch is oversized and the Run bar is out of reach. I-3, I-4 and I-9 must fix this.
- Typing in a 2,000-line module costs about 230 ms per edit in `afterEdit`. Not in scope; noted for `docs/observations.md`.

## Phase 2 — Visual identity

### Done
- I-1 tokens, I-2 migration (old names mapped as in 02, `--tide` folded into cobalt), `tests/a11y/pairs.json` rewritten with an `exempt` map; contrast test green for both themes.
- I-3 top bar (mark, wordmark, file name truncating before its extension, size, Export, Settings, Download), I-4 rail with sticky headers, rounded rows, selected row with a `--marker` bar (the old selector never matched because `aria-selected` is on the `li`; fixed), visible `edited` label next to the dot, and a sheet below 1024 px.
- I-5 buttons (Run is the sodium button; Download is secondary), I-6 inverted status strip with a verdict chip, I-7 editor tokens (`--syn-*`, error line bar), I-8 grid (error cells on `--minium-soft`, row hover), I-9 dialogs and menus on `--raised`, bottom sheet below 640 px, I-10 empty state, I-11 motion (also forced off under reduced motion), I-12 forced colours.
- I-13 mark and favicon replaced, I-14 icon script rewritten (also closes B-22: any and maskable icons at 192 and 512, opaque apple icon, T-B-22), I-15 wordmark in CSS.
- I-16 36 baselines, T-I-03, T-I-05, T-I-06, T-I-07 (`tests/unit/icons.test.js`).
- Screenshots of every baseline were looked at: desktop and 390 px, light and dark.

### Changed expectations
- `downloadButton` in `tests/e2e/helpers.js` (and two direct uses) now targets `.topbar button[aria-haspopup="dialog"]` instead of `.topbar .btn-primary`, because Run is now the single sodium button.
- T-E2E-17 (mobile) opens the Items sheet before tapping a query, because the rail is a sheet at 390 px.

### Not reproduced
- None.

### Blocked
- State 10 of I-16 (print preview) and its 4 baselines wait for Phase 4.

### Deviations
- I-1 values changed where the contrast test required it (see decision 17). I-4 marker colour, I-6 `--readout-alert`.
- I-3: Print is not in the top bar yet (Phase 4). I-7: no current-line highlight (it would need editor code, not styling). I-8: the index column is not sticky; rows are absolutely positioned and the sticky behaviour would need a rewrite of the grid layout. Neither is in the acceptance list.
- Radii are rounder than the document, at the owner's request for a rounded, calm look.
- The mark swaps `src` through JS rather than using `currentColor`, because the existing e2e assertion requires an `<img class="mark">`.

### Manual checks still to do
- The favicon in a real browser tab at 16 px in both OS schemes. It was checked as an `<img>` at 16, 24 and 32 px and reads clearly; a tab is not available here.

## Phase 3 — Edit, run, save

### Done
- E-1 `Session.changes()` returns `{ queries, modules, count }`, computed each call; `editCount` and `isDirty()` read it. Download is `aria-disabled` with the title "No changes yet." when clean and its name becomes "Download — N changes" (the count is hidden below 700 px).
- E-2 revert this item (existing button), revert all through the Changes dialog with a confirmation that names the count; the editor keeps its native undo.
- E-3 `src/core/diff.js` (`diffLines`, `diffStats`, `hunkLines`; the LCS is shared with `module-source.js`); Changes dialog with one expandable unified diff per item, line numbers on both sides, glyph and colour.
- E-4 `src/core/vba/validate.js` (NUL, lone surrogate, code page, 1023-character lines, typed `Attribute` lines, size limit); live check on edit with the gutter marker and the info strip; the Download popover names the problem and disables the button.
- E-5 lifecycle test over done, runtime error, parse error, cancelled and timeout. No code change was needed; the Run and Cancel swap was fixed in Phase 1.
- E-6 the binding dialog names the query, the function and the path; a provided file is remembered for the session only; reload asks again.
- E-7 empty table row, value card, go-to-error link on parse errors, a notice above the grid for lists cut at the display limit.
- E-8 View differences dialog with the first 200 differing cells (row, column, Excel value, quoin value), an honest introduction and a "same text, different type" note.
- E-9 `src/app/file-save.js`: picker save with read-back, replace-original dialog, abort handling; download fallback says only that it downloaded. Tested with a stubbed picker.
- E-10 the round-trip test now also asserts entry order and unchanged index parts on every fixture.
- E-11 every `QuoinError` code has a two-part message; T-LINT-15 and T-E-11; the status strip shows plain text ("Syntax error") instead of codes; the discard confirmation is an in-page dialog, not `window.confirm`.
- E-12 F3 and Shift+F3, shortcuts ignored under a dialog except Escape, focus lands on the rail after opening, keyboard-only loop test, sheet lists every shortcut.

### Changed expectations
- T-E2E-12 final assertion: the clean state is the disabled Download button with the title, not a popover saying "No changes yet." (E-1 asks for a disabled button).
- `openApp` removes `showSaveFilePicker` so the existing download-event tests keep using the download path; the picker path has its own tests with a stub.
- T-A11Y-2 starts its Tab walk from the first top-bar control, because focus now starts on the rail after a file opens (E-12).
- T-B-14 and the overlay test were already adjusted in earlier phases for the disabled Download button.
- grid.spec 'a syntax error blocks the run': the message now also holds the Go to the error button, so the exact-text assertion became contains plus a check for the button (E-7).
- Baselines 05 and 07 were regenerated for the Download label and the plain status text.

### Not reproduced
- None.

### Blocked
- Nothing. G-5 was respected: no file under `src/core/m/**` or the binary writers was touched.

### Deviations
- E-4 test: the plan's euro sign is representable in Windows-1252, so the test uses an arrow (U+2192) as the unencodable character.
- E-6: the dialog does not offer the workbook's own tables first, and Skip ends a run whose only source is missing with that source's M error (not a cell error); a query with other sources still runs.
- E-7: the engine stops at the row cap (`m.rows`) and returns no partial table; the message names the stop. The "first N rows" notice therefore applies to lists cut at the display limit.
- E-8: no "no Excel snapshot" chip; a query with no cached table simply shows no verdict.
- E-9: the source handle is known only for drops in browsers that provide `getAsFileSystemHandle`; elsewhere the replace-original dialog cannot trigger.
- E-10: a signed workbook that loses its signature on save gets its `[Content_Types].xml` rewritten and written first.

### Manual checks still to do (need a real browser)
- `showSaveFilePicker` in Chrome and Edge: save, overwrite the opened file, cancel the picker.
- Open each saved file in Excel (see `05_TEST_PLAN.md` section 4.2).

## Phase 4 — Printing

### Done
- P-1 `paginate` and P-2 `bandColumns` in `src/core/print/layout.js` (integers in tenths of a millimetre, paper and margin tables, `pageGeometry`), P-11 `wrapCodeLines` in `src/core/print/code-lines.js`; T-P-01, T-P-02, T-P-05, T-P-11 are unit tests.
- P-3 `styles/print.css` (twelve named `@page` rules, screen preview and print output share the classes, light-theme colours scoped to `.print-root`), P-4 `src/ui/print-render.js` (pages built 25 at a time, confirmation above 20,000 rows, refusal above 200,000), P-5 repeated header, first rows and last rows (last rows pinned above the foot), P-6 running head and `Page N of M` foot.
- P-7 `src/ui/print-preview.js` with every control in the plan except fit columns to width; P-8 the honest notes plus overflow, shrink and too-small notes; P-9 tab order (panel, then pages), region and names, Escape returns focus to Print; P-10 `beforeprint` fallback; P-12 printed changes with glyphs and numbers from both sides; P-13 decisions 22 and 23; P-14 T-P-14a to T-P-14e, T-P-05b, T-P-11b, T-P-12, T-P-10, T-P-09, T-P-04.
- Visual state 10 (print preview): 4 baselines, which completes the 40.
- The PDF produced from the preview has the preview's page count (40 of 40) and the right media box for A4 landscape and Letter portrait.

### Changed expectations
- None.

### Not reproduced
- None.

### Blocked
- Firefox and WebKit: the browser downloads fail in the sandbox, so no projects were added to `playwright.config.js`.
- The manual print matrix on a real printer.

### Deviations
- `styles/print.css` is linked for all media, not `media="print"`, because the preview uses it on screen.
- Fit columns to width is not offered.
- A chosen rows-per-page that cannot fit at full height is drawn smaller (with a note) rather than clipped or ignored.
- On phones the Print button is hidden and the command is in the Export menu.
- `session` does not store the file name; the preview reads it from the workbook.

## Phase 5 — Hardening and docs

### Done
- README, decisions 14 and 20 to 23, observations (print matrix, MX-10, known gaps).
- `npm run build` was re-run; `asset-manifest.json` lists `styles/print.css`, `src/ui/print-render.js`, `src/ui/print-preview.js`, `src/core/print/*.js`, `src/core/diff.js`, `src/app/file-save.js`, the new icons and both marks.

### Blocked
- Firefox and WebKit runs (see above).

### Not done on purpose
- Sticky index column in the grid, current-line highlight in the editor, a "no Excel snapshot" chip, workbook tables offered first in the binding dialog.

## Phase 2R — Glaze palette and 02B refinement

### Done
- I-R: `styles/tokens.css` rewritten for the Glaze palette (02A) with the 02B size, radius, spacing and type tokens; every stylesheet migrated off the sodium names; `public/favicon.svg`, `mark.svg`, `icon-maskable.svg` replaced and `mark-dark.svg` recoloured; PNG icons regenerated; `tests/a11y/pairs.json` rewritten (T-I-01, T-I-02, T-B-21 green); `tests/unit/glaze.test.js` adds T-I-08 and T-I-09.
- I-V: panes float on the ground with an 8 px gutter; top bar sits on the ground; readout is a floating bar; buttons, menus, popovers, tooltips, dialogs, inputs, rail rows, grid rows and the print panel use the new tokens; touch targets are 44 px; Compact density is a setting kept in memory (T-V-08).
- `T-LINT-17` (radius and control heights come from tokens) and `tests/e2e/refinement.spec.js` (T-V-04, T-V-05, T-V-06, T-V-08).
- Visual baselines regenerated and reviewed by eye.

### Changed expectations
- T-I-04 baselines: regenerated for the new look.
- `tests/unit/icons.test.js`: the sodium block colour is now the celadon mark colour; the maskable ground is `--readout`.
- `aria-valuemin/max/now` on the rail resizer: 220 / 420 / 272.

### Fixed on the way
- `.main > .editor-wrap` never matched because the editor sits in a `display: contents` host; the editor now fills its grid row.
- The status bar goes transparent when there is nothing to say, without removing the live region from the accessibility tree.

### Deviations
- `--celadon-edge` is `#5C9180` (plan `#5E9483` reached 2.92:1 against the ground; the target is 3:1).
- `--madder` is `#B1594C` (plan `#B5574A` has OKLCH chroma 0.125, above the 0.12 cap in 02A §8).
- `--t-code-lh` is 22 px, not 1.6: a 21 px line height misaligned the highlight layer at line 1 500 (T-B-12).
- `pairs.json` exempts only `--line` and `--scrim`; every other token is paired.
- The legacy size aliases (`--r-sm` … `--r-xl`, `--dur-fast`, `--dur-panel`) stay in `tokens.css` until nothing references them.
- Density is not persisted: G-3 allows only `quoin.theme` unless D-1 is approved.

### Blocked
- `T-E-12` (keyboard loop) and `T-P-14b` (PDF export) cannot run in the build sandbox used for this phase; they were not run.
- The visual baselines were produced with Chromium build 1243, not the build that produced the earlier ones.

### Not done
- Run in the top bar, the Changes split-button, the palette and the T1–T4 disclosure tiers: these belong to Phase 6 (WB-10 to WB-13).

## Phase 6 — Workbench (6A and 6B so far)

### Done
- WB-1 `src/core/wb/deps.js`: query index, free-reference analysis with let/function/record scoping, cycles, layers, incremental `updateMember`, upstream/downstream, `topoOrder` (T-WB-01).
- WB-2 `src/core/wb/steps.js`, `step-kinds.js`: step model with spans, comment attribution, inputs, forward references, kinds, linearity, bypass detection (T-WB-02).
- WB-3 `src/core/wb/let-edit.js`: move, insert, rename, delete, bypass, un-bypass, duplicate as text transforms with a change list (T-WB-03, 8 fixture variants × every operation × every position).
- WB-4 `src/core/vba/outline.js`: procedures, parameters, declarations, options, entry points, event handlers, structural problems (T-WB-04).
- WB-5 `src/core/wb/fuzzy.js`: ranges, ranking, diacritics, CJK and RTL, 10 000 items in under 30 ms (T-WB-05).
- WB-6 `src/core/wb/m-gen.js`: filter, sort, remove/keep/rename columns, change type, remove duplicates, keep first rows, replace value; every generated step is executed in the engine in the test (T-WB-06). Step names are in `S.stepNames`.
- WB-7 `engine.js`: `evaluateSteps` (one pass, each step forced once, dependants `skipped`, `upTo` for run-to-here) and `evaluateMany` (one context, per-member deadline, binding rounds through `next()`); equivalence with `runOnce` is asserted for every member and every step of every external fixture (T-WB-07).
- WB-8 `src/core/wb/result-store.js` and worker protocol v2: store with LRU, pinning, groups and a cell budget; `run-steps`, `run-many`, per-result `rows`, `pin`, `release`, `evicted`; the runner gains `stream`, `runSteps`, `runMany`, generations and `rowsOf` (T-WB-08, unit and e2e).
- WB-9 `run-plan.js`, `status.js`, `src/app/orchestrator.js`: run modes, FNV-1a fingerprints over normalised text, upstream fingerprints, binding keys and culture, stale tracking, ten-run history, stop at first error (T-WB-09).

### Changed expectations
- None of the existing tests were changed in this stretch.

### Deviations
- `StepRecord` is a new internal node kind in `eval.js` that returns the let's own thunks as a record, so each step is forced once without a self-referencing record literal.
- `Thunk` no longer caches an error that is marked `retryable` (`NeedBinding`), so a member can resume after a binding is supplied in the same context.
- Step names made unique as `Filtered Rows 1`, as `WB-6` writes it, although Excel itself writes `Filtered Rows1`.
- `moveStep` and the other transforms refuse comma-first formatting with a reason, rather than reformatting it.
- The worker messages `view` and `profile` from WB-8 are not built; they belong with the result dock (WB-16).

### Blocked
- Nothing blocks 6C, but `T-E-12` and `T-P-14b` still cannot run in the build sandbox.

### Not done
- The orchestrator is not wired into the app yet: the Run split-button, the navigator selection bar, the Queue tab and removing the coupling where selecting an item cancels a run all belong to WB-10 to WB-16.
- Fixtures `many-queries.xlsx`, `macro-links.xlsm` and `cp932.xlsm` are not generated; the WB-9 e2e (run all on `many-queries.xlsx`, edit a staging query, run stale) needs `many-queries.xlsx`.
- WB-10 to WB-28 (shell, navigator, tabs, palette, steps panel, result dock, graph, problems, sources, editor intelligence, VBA workbench, proof).

### WB-13 (partial, done ahead of the shell)
- `src/app/commands.js` and `app-commands.js`: one command registry with ids, shortcuts, `enabled()` reasons and surfaces; browser-reserved shortcuts are refused at registration; the key handler in `main.js` and the shortcut sheet are both generated from it (T-LINT-16, T-WB-13 unit).
- `src/ui/wb/palette.js`: Ctrl/Cmd+K and Ctrl/Cmd+Shift+P open a combobox over queries, modules and commands, with `>` commands, `@` procedures, `#` steps of the open query and `:` go to line; disabled commands show their reason (T-WB-13 e2e).
- Changed expectations: the shortcut sheet is now built from the registry (its rows and wording changed); the top bar gains a Search button; all 40 visual baselines were refreshed with `--update-snapshots=all` because the earlier updates had stayed inside the 0.2 % tolerance and kept stale images.
- Not done: the Run modes (`run stale`, `run all`) are not commands yet because the orchestrator is not wired to the UI, so `>run stale` from the acceptance story does not exist yet.

### WB-14 (partial): the Steps panel
- `src/ui/wb/steps-panel.js` and an inspector column in the workspace (visible from 1100 px for queries, toggled with Ctrl/Cmd+Alt+B or the Steps button): every step with a kind chip, bypass tag, row delta and a warning for a forward reference; keyboard rows (arrows, Home/End, Enter go to step, F2 rename in place, Delete, B bypass/restore, Ctrl+D duplicate, Alt+Shift+Up/Down move, Ctrl+F10 run to here) and a menu for the same actions.
- Every edit is a text transform from `let-edit.js` applied through `Editor.replaceDiff`, so it lands in the editor's own undo stack and in the dirty/Changes model; a refused edit says why in a live region and in the status line; a move that needs rewiring asks first.
- "Evaluate steps" runs `runSteps`; each step gets a status bead, a row count and its own stored result, and clicking a step shows that result in the grid (paged through its result id).
- Tests: `tests/e2e/steps-panel.spec.js` (T-WB-14, 7 tests).
- Not done: drag-to-reorder grip, the insert-step affordance, the Depends on / Used by block and impact line, step results refreshed automatically after Run (it needs an explicit "Evaluate steps"), the narrow-screen presentation of the panel, and run-to-here result paging beyond the 200-row preview for the legacy run path.
- Renamed the panel button "Evaluate steps" because existing tests (and users of assistive technology) find Run by a name starting with "Run".

### WB-9 (UI wiring)
- The orchestrator now drives Run all (Ctrl/Cmd+Alt+Enter), Run stale (Ctrl/Cmd+Shift+Enter) and Run with downstream (palette); rail dots carry a status (ran, error, out of date, stopped, waiting, function); the status line summarises a batch; a finished query opens with its stored result without running again; selecting another item no longer cancels a running batch; Escape or Cancel stops it and marks the rest cancelled (`tests/e2e/run-modes.spec.js`).
- `indexSection` now treats `let f = (x) => ... in f` as a function, as the rail already did.
- Not done: the Queue tab (a per-batch list with durations), Run selected (needs multi-select in the navigator), and the Run split-button menu; the commands are reachable from the keyboard and the palette only.

### 6D and 6E, pure parts and the first UI
- WB-19 `src/core/wb/sources.js`: literal and dynamic sources, bindable or not, the binding key equal to the one the engine raises (asserted against `runOnce`) (T-WB-19). No UI yet: the Sources list in the menu, binding up front and the Run all check are not built.
- WB-23 `src/core/vba/structure.js` (a separate file from `outline.js`, which now exports its line and statement splitters): block balancing for every block kind, stray and unclosed closers, duplicate procedures, wrong `Exit` kind (T-WB-23). Not built: gutter markers on edit and the Download tooltip listing them.
- WB-24 `src/core/vba/refs.js`: call graph from identifier scanning with locals, member access, qualified names, `Application.Run`, private and `Option Private Module` visibility (T-WB-24). No UI yet: Find references, Go to definition, the Calls section and the "no callers" note.
- WB-18 `src/core/wb/problems.js` and the Problems dialog: all codes except `m.unsupported` coverage beyond the engine's own `unsupported` list; computed in idle slices of at most 8 ms after open and again 300 ms after an edit; a counter in the status bar opens a filterable list; Enter or a click opens the item at the position (`tests/e2e/problems.spec.js`, 4 tests including a long-task check). It is a dialog, not a dock tab, because the dock does not exist yet.
- Changed expectations: all 40 visual baselines refreshed (the status bar gains the Problems counter).

### WB-22 (partial): macro outline and per-procedure revert
- `src/core/vba/proc-diff.js`: procedures matched between the original and the current text by kind and name (Property Get/Let/Set and repeated names kept distinct), marked same, edited (trailing whitespace and line endings ignored), added, removed; revert replaces only that procedure's lines, removes an added one with its blank line, or puts a removed one back after the procedure that preceded it, keeping the current line ending (T-WB-22 unit, 10 tests).
- `src/ui/wb/outline-panel.js`: the inspector shows the outline for a macro (options, declarations, procedures with kind, signature, private, entry point, event, edited, added, removed with Put back); the caret follows into the highlight and into the item head as `kind › procedure`; every revert goes through the editor's own undo stack (`tests/e2e/outline.spec.js`).
- Not done: the search-everything `@` scope across all modules is done in the palette, but there is no Find references, Go to definition, Calls section or the "no callers" note in the panel; no `vba-big.xlsm` fixture, so the 60-module budget is not measured.

### WB-21: find and replace across the workbook
- `src/core/wb/find.js`: plain, case, whole word (letters, digits and underscore, any script), regular expression, code only (lexer for M, a character scanner for VBA that understands doubled quotes, apostrophe and `Rem` comments); matches carry line, column and the line text; a 50 ms budget per chunk with a cooperative yield, a 20 000 match cap, an invalid expression reported with its message, replacement templates with `$1`, `$&`, `$$` (T-WB-21 unit, 17 tests).
- `src/ui/wb/find-dialog.js` and the workspace: Ctrl/Cmd+Shift+F find, Ctrl/Cmd+Alt+F replace, also in the palette; results grouped by item with highlighted line previews, a checkbox and a live "after" line per match, Select all/none, "Replace N selected"; one editor operation per item, so one undo step per item; a read-only item's matches are listed as skipped with the reason (`tests/e2e/find.spec.js`, 5 tests).
- Not done: the "selection in the navigator" scope (there is no multi-select yet), the dock placement (it is a dialog), and an e2e with a locked VBA project fixture (the skip reason is covered in the unit tests).

### WB-25 and WB-26 (UI wired)
- `src/core/vba/pq-links.js`: `Connections("Query - X").Refresh` (also `.OLEDBConnection.Refresh`), `ListObjects(...).QueryTable.Refresh`, `Queries("X")`, `RefreshAll`, `With` blocks (nested), continuations and colons, comments and strings ignored, doubled quotes, non-literal arguments reported as dynamic, unknown names flagged, table names mapped through each query's load target; `runPlanOf` keeps the macro's order, `refreshedBy` maps a query to the procedures that refresh it (T-WB-25 unit, 15 tests; `tests/e2e/macro-links.spec.js`, 3 tests).
- The outline lists, under each procedure, the queries it refreshes, what it reads or changes, what cannot be resolved and what is not in the workbook, with a **Run these queries** button that runs exactly those, in the macro's order (`run-selected` with `ordered`), and says that the rest of the macro does not run; a query shows "Refreshed by …" in the steps panel.
- `src/core/wb/step-diff.js` and `src/app/change-summary.js`: the Changes dialog now shows, per query, reordered, added, removed, bypassed, restored and changed steps (renaming a reference alone is not a change), per macro the edited, added and removed procedures, and the errors and warnings of the changed items at the top (T-WB-26 unit, 11 tests; `tests/e2e/change-summary.spec.js`, 2 tests).
- Not done: the navigator filter chip "Linked to a macro", the Calls and Called-by sections, Find references and Go to definition in the editor, and printing the summary (P-12 still prints the line diff).

### WB-17: dependency view
- `src/core/wb/graph-layout.js`: longest-path layering with cycles handled (the closing edge is marked cyclic and drawn dashed in `--madder`), four barycentric sweeps, integer coordinates, bezier edge paths, neighbourhood (2 levels each way by default), up and down paths, impact count; 320 nodes lay out in well under 200 ms (T-WB-17 unit, 11 tests).
- The inspector shows Depends on and Used by with status beads under the steps, an impact line ("Editing this affects 1 query (1 loaded to sheets)" or "Nothing else uses this query."), and a Graph button; `svg()` was added to `src/ui/dom.js`.
- The graph (a dialog; palette command "Show the dependency graph"): layered SVG with nodes, status beads and edges; the selected node's upstream and downstream paths are highlighted; Left and Right walk along edges, Up and Down move between siblings, Enter opens, Shift+arrows pan, `+`/`-`/`0` and the buttons zoom and fit, Ctrl/Cmd+wheel zooms, drag pans; neighbourhood by default with Show all and Show only this neighbourhood; Open, Run and Run with downstream act on the selected node. The region is `role="application"` with a label that explains the keys, and the selected node's relations are read out in a live region (`tests/e2e/graph.spec.js`, 3 tests).
- Not done: the graph as a dock tab and the `G` shortcut from the navigator (there is no navigator focus model yet), and a many-queries fixture for the impact-count check.

### WB-27 (budgets for what exists) and the many-queries fixture
- `tests/fixtures/workbooks/many-queries.xlsx` (generated by `npm run fixtures`, which now has `addQueries` and `manyQueries`): 320 queries — 12 staging, 9 whose name contains "sales" (one with a parse error, one function), three layers of derived queries, six helper functions, a 12-step query, and four deliberate problems (a parse error, an unresolved name, an unsupported connector, an unbound file) so the Problems counter reads 4, then 3 once the parse error is fixed.
- `tests/e2e/budgets.spec.js` measures and asserts, with a `QUOIN_PERF_FACTOR` (default 2): open to interactive, problems scan, long tasks, selecting a query, evaluate steps against a plain run, a step click, the graph opening, and Run all's first result. Three consecutive runs on the build machine: open 780–980 ms (budget 1500), problems scan 920–1060 ms (3000), no long task during the scan (50), selecting a query 14–33 ms (100), evaluate steps 114–152 ms against a plain run of 119–159 ms (ratio about 1; budget 1.3), step click 7–11 ms (50), graph of 320 nodes 16–22 ms (200), Run all first result 560–650 ms (500 at 1×), Run all total about 2.1 s. The long task while the workbook itself is parsed and the rail is built is 370–510 ms and is not covered by a budget in the plan.
- Not measured: `vba-big.xlsm` (60 modules, 40 000 lines; no generator can write a VBA project of that size), the navigator search keystroke (there is no navigator search), `F10` step stepping (not built), and the editor and grid frame budgets (covered by the existing T-PERF tests only).
- Note: the engine refuses to run any query while one query in the section does not parse, so Run all on this workbook needs the parse error fixed first, exactly as the acceptance story does in its step 2.

### WB-11: the navigator UI
- `src/ui/wb/navigator.js` replaces the old rail tree. The `.rail` element stays the scroller; inside it a sticky search box, then scrolling controls (Group by, Sort by, filter chips), then a virtualised `role="tree"` list of absolutely positioned rows (a window of rows plus 8 of overscan, the open or focused row always kept, the owning group header pinned while its items scroll). Rows are keyed and reused, so selecting never rebuilds a node (T-B-10 still passes unchanged).
- Search: fuzzy on names with highlighted ranges; `code:` shows the match count on each row and Enter opens the first match at its line; `step:` searches step names. Group by Folder, Load target, Status, Layer, None, with sticky headers, counts per status and collapse (Enter, Space, click, Left and Right). Sort by file order, name, last run, duration, rows. Chips Edited, Errors, Stale, Never run always visible, the other four behind `+ More` and shown as soon as they are on; counts live.
- Multi-select: click, Shift+click, Ctrl/Cmd+click, Space, Shift+Arrow, Ctrl/Cmd+A, Escape clears. From two items a selection bar offers Run, Run with downstream, Revert, Show in graph and Copy names (also in the row context menu). Run goes through `orchestrator.run('run-selected')`; "with downstream" adds `downstreamOf` of the selection first.
- `Workspace` now builds the navigator lazily in `renderRail` and gives it a source (queries, modules, statuses, records, text, step names, macro links) and actions (open, run, revert, graph, notify). `allPqLinks` is memoised per module text so the Linked to a macro chip is cheap. `railKey` is gone.
- Tests: `tests/e2e/navigator.spec.js` (T-WB-11, 13 tests on `many-queries.xlsx`): `sclean` finds `Sales_Clean` first, `code:Table.Group` gives the two queries with "1 match", `step:`, group by Layer (three groups, positions, collapse, ArrowRight expands), chips and More, Edited chip follows an edit, five selected queries run and exactly five get results, Run with downstream, virtualisation (under 80 rows, `aria-posinset` 1 and 320 of 320, last row reachable), keyboard selection, Copy names on the clipboard, row menu Revert, sort and its disabled state while searching.

#### Changed expectations
- `budgets.spec.js` T-WB-27: the 320 rows are no longer all in the DOM. The assertion is now a window (more than 10 and fewer than 80 rows) plus `aria-setsize` 320 on the first row; the two tests that clicked `Wide_Steps` (index near 300) open it through the search box (`openByName`).
- `palette.spec.js` T-WB-13 `@`/`:` test: the final line is read with `expect.poll`. The palette runs its handler in a 0 ms timer after the dialog closes and the old test read the caret once, immediately; with the navigator on the page that read lost the race about one run in three (the unchanged baseline passed 8 of 8, so this is a timing change, not a behaviour change).
- 18 visual baselines regenerated with `--update-snapshots=all` (the rail has a search box, controls and a different row structure); the 390 px states with the rail closed did not change. Looked at: the Macros state at 1280×800 light, and by hand the 320-query list in light, dark and at 390×844.
- Strings: the search placeholder is now "Search, code: or step:" and the default sort is "File order" so both fit in the 272 px rail.

#### Deviations
- One list, not two. Queries and Macros are two sections of the same tree (as before) instead of a segmented control with `Ctrl/Cmd+Shift+1/2`; every existing rail test, the macro outline and the palette depend on modules being in the same tree. The filters that only make sense for queries hide the Macros section; Edited applies to both; `code:` searches both.
- The list is always `role="tree"` with `treeitem` rows (`aria-level` 1 or 2, `aria-posinset`, `aria-setsize`, `aria-multiselectable`), not a `listbox` when ungrouped: T-B-10 and the accessibility test require `treeitem`.
- The selection bar has no Print entry (printing a selection is not built). Its buttons read "Run" and "Run with downstream" but their accessible names are "Selection: run" and "Selection: run with downstream", because the existing tests find the Run button by `/^Run/`.
- Only the search box is sticky; Group by, Sort by and the chips scroll with the list. A fully sticky header was 168 px high and covered the whole rail in the 260 px high T-B-10 test.
- `Ctrl/Cmd+Arrow` moves focus without opening or selecting, so a non-contiguous selection can be built from the keyboard (Space toggles). Plain Arrow still moves, selects and opens, as before.
- Sorting by last run uses the time at which the navigator first saw a settled status for the query in this session; the status book has no timestamps and `src/core` was left alone.
- With no folders in the workbook, Group by Folder shows a plain list instead of one "No folder" header.

#### Not done
- Palette commands for the five selection actions (the bar and the context menu have them).
- The bypassed-steps count on a row (it needs the step model of every query on every refresh).
- Preview versus permanent tab on click and double-click (WB-12).
- The segmented Queries and VBA lists (see Deviations).
- Observed, not mine: at 390 px the Search button in the top bar overlaps the file name. It belongs to WB-10.

