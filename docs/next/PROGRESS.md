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

### WB-12: tabs and split
- `src/core/wb/tabs-model.js` (pure, 12 unit tests in `tests/unit/wb-tabs.test.js`): groups of tabs, an active tab per group, preview tabs (one per group, replaced by the next preview, made permanent by a permanent open or an edit), open after the active tab, close activates the neighbour, split (needs two tabs, moves the active tab to a second group), join, move between groups, cycle, go to the nth tab, and caret and scroll memory per tab. An item lives in one group at most.
- `src/ui/wb/tabs.js` is the tab strip: a `tablist` of `tab` buttons (status bead, name in italics when it is a preview, an ochre dot and a screen reader word when edited) with a close button each. Arrow keys, Home and End move focus, Enter or Space activates, Delete closes, middle click closes, double click keeps a preview open, right click opens a menu (Close tab, Keep this tab open, Open in a split to the right or Move to the other group, Join the groups) so every drag has a menu equivalent.
- `Workspace`: `select(item, { preview, force })` opens or activates a tab, saves the caret and scroll of the tab it leaves, loads the item into the active group's editor (each group owns an `Editor`; `this.editor` always points at the active group's), and restores the remembered caret and scroll. Focusing a group makes it active. Editing, double click, Enter, the palette, the graph and `code:` Enter open permanent tabs; a single click and the arrow keys in the navigator open previews. Closing a tab never discards its edit (it stays in the session and returns when the item is opened again). The last open tab cannot be closed. Splitting needs a window of at least 900 px.
- Commands: Alt+W close tab, Alt+[ and Alt+] previous and next, Alt+1 to Alt+9 the nth tab, Ctrl/Cmd+\ split or join. Commands now receive the keyboard event as their second argument (needed for the digit).
- Tests: `tests/e2e/tabs.spec.js` (T-WB-12, 8 tests): preview versus permanent, open six, split, edit in both groups, close an edited tab and reopen it with the edit intact, shortcuts, caret memory, drag to the split zone and between groups, menu and keyboard equivalents, join and the narrow window, tablist semantics.

#### Changed expectations
- `main.js`: the page-wide drag handlers only act on drags that carry files (or that carry no data at all, for the synthetic events in T-B-16). Before, every drag was forced to `dropEffect = 'copy'`, which turned any non-file drag into a refused drop. T-B-16 is unchanged and passes.
- `tests/unit/wb-commands.test.js`: the stub workspace in the availability test gained `canCloseTab` and `canSplit`, and the test now also checks that Close tab reports its reason.
- 24 visual baselines regenerated (the tab strip sits above the editor on every workspace screen). Looked at the query-selected state at 1280×800 light.

#### Deviations
- Splitting an item into the other group moves it; the same item is never open in two groups, so there is no text to keep in sync between two editors. The text of the item shown in the inactive group is refreshed from the session whenever statuses repaint.
- Reopening a closed tab is done by opening the item again; there is no reopen shortcut.
- The shortcut sheet shows `Alt+1 to Alt+9` as one line (`shortcutLabel` on the command).
- On mobile the strip is shown but cannot be split; the split command and the menu entries say the window is too narrow.

#### Not done
- Reordering tabs by dragging inside a strip.
- A visible resize handle between the two groups (they share the width equally).

### WB-10: layout, collapse, F6, the mobile bottom bar (partly done)
- `src/ui/wb/panes.js`: `paneRail` (the 32 px collapsed rail with its expand button), `bindResizer` (keyboard and pointer, one implementation for the navigator and the inspector) and `Regions` (F6 cycling that lands on the last focused element of each region, on the expand button of a collapsed pane, and skips regions that are not shown).
- Collapse and restore by key and by pointer: navigator `Ctrl/Cmd+B` (a collapse button sits next to the search box), inspector `Ctrl/Cmd+Alt+B` (the Steps or Outline button, plus the rail), result dock `Ctrl/Cmd+J` (a button at the end of the run bar, plus the rail). A collapsed pane is a 32 px rail in the sunk tone; focus moves to the expand button when the pane that held it collapses. Below 1024 px `Ctrl/Cmd+B` opens and closes the Items sheet instead.
- The inspector now has a separator (260 to 480 px, default 312 px) with the same arrow keys and drag as the navigator's. The rail and inspector handles sit above the list rows (the Macros label row used to cover the rail handle, so dragging it did nothing).
- `F6` and `Shift+F6` cycle navigator, editor, inspector, dock and readout.
- At 390 px the segmented control became the floating bottom bar: Items, Code, Steps, Result and the Problems counter (the counter in the readout is hidden there so it is not read twice). Steps shows the inspector as a full-height sheet. The Items button inside the bar keeps the class `rail-toggle`; the old head button is now `rail-toggle-wide` and only shows between 640 and 1023 px.
- A "More ways to run" menu button follows Run in the run bar: run the selected queries, run this query and what depends on it, run the stale queries, run every query. New command `runSelected` (palette).
- Top bar at 390 px: the `Ctrl K` hint is hidden and the file name is clipped inside its button, so the name no longer prints over the Search button.
- Tests: `tests/e2e/layout.spec.js` (T-WB-10, 8 tests): collapse and restore for the three panes by key and pointer, resize of all three separators by keyboard and pointer, F6 and Shift+F6 order, F6 onto a collapsed rail, the run menu, and the 390×844 bottom bar (each region reachable, nothing wider than the screen, the bar's buttons present).

#### Changed expectations
- `.segmented` is now the bottom bar and lives in `.workspace`, not in `.main`; the grid row it used in `.main` is empty. `T-E2E-17` and `states.js` still find Items, Code and Result by name and by `.rail-toggle`, unchanged.
- The inspector no longer disappears when closed on screens of 1100 px and wider; it leaves a 32 px rail. `steps-panel.spec.js` T-WB-14 now checks `data-inspector` closed or open, the hidden Steps content and the expand button instead of `.inspector` hidden.
- 28 visual baselines regenerated; looked at the 390×844 query-selected state and by hand the Steps sheet.

#### Deviations and not done
- Run stays in the run bar under the editor instead of moving to the top bar, and the Changes split button is not built (WB-16 owns Changes). The menu next to Run has no "run to here"; that action stays in the steps panel.
- `workbench.js` does not replace `workspace.js` and there is no `Layout presets` menu yet.
- Between 640 and 1099 px there is still no inspector (Steps is only reachable at 390 px and at 1100 px and wider).
- The top bar at 390 px still leaves the file name almost no room; the overflow menu of 02B §4.1 is not built.

### WB-16: the result dock (first slice)
- `src/ui/wb/dock.js`: the result panel now has a `tablist` (Result, Pinned, Compare, Problems, Queue, Graph; arrows, Home and End walk it, the selected tab is the one tab stop) and one `tabpanel` per tab. The existing result content (progress, crumbs, row cap notice, grid, sources) lives in the Result panel unchanged. Tabs show a count badge (pinned, problems, queue).
- Problems and Graph are tabs instead of dialogs: `problems-dialog.js` became `problems-view.js` (`mountProblems`), `graph-view.js` exports `mountGraph`. The status counter, the 390 px bar counter, the palette and the Graph buttons all open the tab; opening one expands a collapsed dock and, at 390 px, switches to the result region. For a macro the dock is normally hidden; it opens when a tab other than Result is chosen and closes again when Result is chosen. Opening a node, running it or running it with its downstream from the graph leaves the graph tab on screen (Run goes to Result, Run with downstream to Queue).
- Pin: a Pin this result button above the grid keeps the current table result in the worker store (`runner.pin`, protected from eviction until the store is over its limits). The Pinned tab lists query, step, time and shape, says Out of date when the query text has changed since, and offers Show, Compare and Unpin. The plain Run path now passes `resultId` to `renderResult` (it did not; only step runs did).
- Compare: choose two results (pinned ones plus the current one); schema diff first (added, removed, retyped columns), then the row count change, then the first 200 differing cells by position out of the first 1000 rows of each. The logic is `src/core/wb/compare-results.js` (4 unit tests).
- Queue: the last batch from `orchestrator.queue()` with status, rows and time per query and a total.
- Tests: `tests/e2e/dock.spec.js` (T-WB-16, 7 tests) and `tests/unit/wb-compare-results.test.js`.

#### Changed expectations
- `problems.spec.js` and `graph.spec.js` no longer look for `dialog.problems` and `dialog.graph`; they use `.problems-panel` and `.graph-panel` and check the Problems tab is selected. Clicking a problem row or a graph node no longer closes anything, and Escape no longer closes the list.
- `tabs.spec.js` (T-WB-12) now scopes its locators to `.tabstrip`: the dock tabs are `tab` elements too, so `getByRole('tab')` counted both strips.
- Visual baselines regenerated (the dock tab strip is on every result view).

#### Not done in WB-16
- The result header line (`928 rows · 6 cols · 41 ms · step 5 of 7`) and the Excel verdict chip in the Result tab; Export per result id from the dock.
- (Built since, see "WB-16: the column header menu" below: filter, hide, profile, Add as a step, the `view` and `profile` worker messages, `profile.js`, the profile sheet and the view-only chip.)
- Side by side grids with synchronised scroll in Compare, comparing a step with the previous run, quoin against Excel.
- The Changes tab (WB-17).

### WB-14 and WB-15: step cursor, drag, insert, narrow inspector
- Step cursor: `F10` and `Shift+F10` (and `J` and `K` when a step row has focus) move to the next or previous step. The editor goes to the step's line, the panel marks it current, and the step's stored result is shown in the Result tab without a run; a step with no stored result says so in the status line. The commands only act while focus is in the editor or the steps panel, so `Shift+F10` stays the browser's context menu key everywhere else (the navigator rows and the tab menus depend on it).
- Drag to reorder: every row has a grip (shown on hover or focus, hidden on coarse pointers; the keyboard and menu ways remain). While dragging, each gap is checked with `canMove`: a usable gap shows a slate line, an unusable one a dashed madder line and a note with the reason (the drop is refused). A drop that needs rewiring goes through the same confirm dialog as the keyboard move.
- Insert step after (`Insert` on a row, or the step menu): an inline editor under the row with a name (a free `StepN`) and an expression (the previous step's name), Enter applies, Escape cancels. The new step is wired in (the next step is rewired to read it when it read the previous one; otherwise the step is added unwired). A name that exists is refused with the reason.
- Narrow screens: between 640 and 1099 px the Steps or Outline button opens the inspector as a sheet over the editor, `Escape` closes it and returns focus to the button. At 390 px the bottom bar still does this.
- Tests: `tests/e2e/step-ops.spec.js` (9 tests, T-WB-14 and T-WB-15) on `pq_simple.xlsx`.

#### Deviations
- `Shift+F10` and `F10` are scoped to the editor and the steps panel (see above); the plan makes them global.
- No gutter band for the current step in the editor (the editor has no decoration layer for it yet); the panel's current marker and the caret line carry it.
- Peek, Pin a step, Invoke for function queries, delta chips for columns, types and renames, the Count rows setting, Add as a step from a view filter and Insert from the grid header are not built (the last two need the WB-16 column menu).

#### Not done in WB-15
- The operation history with Undo in the status region and the History popover, the multi-step preview popover with Apply and Cancel, and Auto-run steps after structural edits. The text of the editor still undoes with the editor's own undo.

### WB-16: the column header menu
- The column header menu of a stored table result now has Filter, Hide in view, Profile column and, for a query written as `let`, Add as a step, beside the existing Sort ascending, Sort descending and Copy column name. They appear only when the grid shows a result held by the worker (`grid.columnTools`, set by `Workspace.attachColumnTools`); drill-ins, lists and records keep the old menu.
- `src/core/wb/profile.js` (pure, over a cell accessor): count, nulls, errors, distinct (capped at 10 000 and then shown as `10,000+`, with the top values marked approximate), minimum, maximum and mean of the finite numbers, earliest and latest for dates and date-times, text length range, the top values with count and share, and the kinds of value present (a column of mixed kinds is flagged). 10 unit tests, including a million rows under a second.
- `src/core/wb/view-ops.js` (pure): view-only filter, sort and hide over an `MTable`. It uses `valuesEqual` and `compareValues` from `values.js`, so a view filter keeps the rows the matching `Table.SelectRows` keeps (a null on either side of `<`, `>`, `<=`, `>=` drops the row; comparing unlike kinds fails with the engine's message). 32 unit tests; every filter operator, null handling, ignore case, dates and the sort variants are compared against the result of the step `m-gen.js` generates, run through the engine on the same `#table`.
- Worker and runner: `view` (builds a derived table from the stored result, stores it as a new result id, returns the first 200 rows, the columns and the row counts) and `profile` (chunks of 4 096 rows through `serializeTableRows` on a one-column table; `top` sets how many values come back). `Runner.view` and `Runner.profile`. Nothing in `engine.js`, `lexer.js`, `parser.js`, `values.js` or `library/` changed.
- Filter dialog: by values (search box, ticks kept while searching, the 200 most common values and a null entry, with a note when there are more) or by condition (operator and value, ignore case for text; numbers and dates are checked before they are sent). Applying a filter on a column replaces that column's earlier view filter. The view-only chip beside Pin says `View only · 3 of 6 rows · 1 filter · 1 column hidden`, with Clear view; the query text is never touched, and a re-run, another query or a non-table result drops the view and releases its stored result.
- Profile sheet: a side sheet with the figures above, the top values with bars (each is a button that filters the view to it) and the kinds of value; mixed columns are called out.
- Add as a step: a dialog with the action (sort ascending or descending, filter rows, remove this column, keep only this column, rename, change type to text, number, whole number, date or true/false, remove duplicates), its parameters, the step name and the exact M in an editable box (editing it stops regeneration until Use the generated code). Insert puts the step after the step whose result is shown (the last step when the final result is shown), rewires the next step, moves the caret to the new step, and runs the steps up to it. A name that exists, or text that does not parse, is refused in the dialog with the reason.
- Tests: `tests/e2e/column-tools.spec.js` (12 tests: filter by condition, two filters and replacement, values list with search, empty and invalid input, hide, profile figures of a number and a text column, Add as a step with the new step equal to the earlier view, an edited expression and a refused duplicate name, rename and change type M, the menu on a plain expression, Enter and Escape on a header) and the two unit files above. The fixtures are inline `#table` queries typed into `pq_simple.xlsx`'s query, with fixed expected figures; `wide.xlsx` from the plan does not exist.

#### Deviations
- The Sort entries in the column menu are still the grid's display sort (it keeps the original row numbers and works to 200 000 rows). The worker `view` accepts a `sort` and it is unit tested, but no menu item uses it, so the view-only chip covers filters and hidden columns, not sort.
- `Alt+Down` on a focused header was tried and removed: it is already the global "next item" command (`app-commands.js`), and the two fired together, which moved to the next query and hid the grid. Enter and Space open the header menu, and Escape returns focus to the header (tested).
- Filtering by the values list is limited to the 200 most common values; filters on time, duration and date-time-zone columns offer only the null checks in practice (other operators compare as text and fail with the engine's message, which the view reports in the status line).
- Text length counts UTF-16 units.
- "Add as a step from a view filter" is a menu action on the column, not a button on the chip: the chip's filters are not turned into steps in one click.

#### Not done in WB-16 (still)
- The result header line and the Excel verdict chip, Export per result id, side by side Compare, the Changes tab.
- A view sort in the menu, and filtering a view by a cell's value from the cell menu.

### WB-16: result header line, verdict chip, per-result export, Changes tab, side by side compare
- Result tab: the Pin row now carries a header line (`6 rows · 3 columns · 12 ms · step 2 of 2`; the step part appears for `let` queries and follows the step cursor, and a plain run counts as the last step), the Excel verdict chip beside it (matches, differs in N cells, row count differs, columns differ, or not compared for time dependent and random queries; none for a step result), and a `Get a file` menu (CSV, CSV with BOM, TSV, JSON, XLSX) that exports exactly the result shown by result id. With a view on, the menu says it exports the view, and a hidden column is left out of the file. The top bar Export is unchanged and still exports the last run result.
- Dock: Changes is the seventh tab (Result, Pinned, Compare, Problems, Queue, Graph, Changes) with a count badge. `changesBody` in `dialogs.js` is shared by the Changes dialog and the tab (same diffs, summaries and problems); the tab adds Revert all behind the same confirmation and refreshes 250 ms after an edit while it is open.
- Compare: a Show side by side option puts the two chosen results in two grids that scroll together (both directions, no feedback loop because a scroll position is only copied when it differs). Cells that differ in the rows compared (the first 1 000, marks capped at 200, as before) are marked in both.
- Tests: `tests/e2e/result-head.spec.js` (5: line and step, a non-let query and a list, verdict match and differ on `pq_vba_complex.xlsm`, export of the whole result and of a filtered view as TSV, hidden column left out), `tests/e2e/changes-tab.spec.js` (3: empty state then diff, Revert all with cancel then confirm, the dialog from Download), `dock.spec.js` (tab list now has Changes; side by side with two 300 row results differing in one cell, scrolled both ways). Visual baselines `05-result-10000-rows` (four) and `06-result-differs` at 390 wide (two) regenerated after looking at them; the visual spec is run on its own (`tests/e2e/visual.spec.js`, 40 pass) because the full run excludes `T-I-04`.

#### Deviations and things to know
- The Result tab button is called Get a file, not Export: two buttons named Export made the existing export tests ambiguous, and Save and Download are taken the same way.
- The header line first sat on its own row; that made the grid one row shorter and broke `T-B-11` (PageDown moved 5 rows, not more) and `T-B-13` (a header click in a 380 px high window). It now shares the Pin row, stays on one line above 700 px wide (the verdict chip is cut with an ellipsis and its title holds the full text) and wraps below that.
- On a phone width the seven dock tabs scroll sideways, so Graph and Changes are off screen until the strip is scrolled. The Changes dialog is still reachable from Download.
- The verdict is also still in the status bar; the two read from the same result.

#### Not done in WB-16 (still)
- A view sort in the column menu, and turning the view filters on the chip into steps in one click.

### WB-16, WB-14, WB-15: the view as steps, and the operation history with Undo
- `src/core/wb/view-steps.js` (pure): `viewActions` and `insertViewSteps` turn a view into one filter step per filter plus one Remove Columns step for the hidden columns, chained after a chosen step with `insertStepAfter` and rewiring, so the step after them (or the `in` line) reads the last new step. 6 unit tests run the resulting text through the engine on a `#table` and compare its rows and columns with `applyView` on the same table (two filters and a hidden column, values filter with a null, ignore case, a chain with a following step, unique step names, refusals).
- The view chip row has Add as steps (only when the shown result is a step of a `let` query). One click inserts the steps as a single text change, moves the caret to the last one, and runs the steps up to it; the view is dropped and the new last step's grid equals what the view showed (`tests/e2e/column-tools.spec.js`, now 14 tests).
- `src/core/wb/op-history.js` (pure): per query, the last 50 operations with label, before and after text. `undoable(text)` is true only while the text is still the result of the last operation. 4 unit tests.
- Every operation that goes through `applySteps` (move, rename, delete, bypass, put back, duplicate, insert, Add as a step, Add as steps) is recorded with the editor's own text before and after. The steps panel head shows Undo for 10 seconds after an operation (its accessible name says which one) and `Ctrl/Cmd+Z` with a step row focused does the same; in the editor `Ctrl/Cmd+Z` stays native. Undo puts the text back exactly; if the text was edited by hand since, it refuses and says so. History appears once the query has an operation and opens a popover of the operations newest first with Restore this version on each and a last row for the text before the first operation. A restore is itself an operation, so nothing is lost by restoring. The history is in memory per query, never touches `original`, and is dropped on reload.
- `tests/e2e/step-history.spec.js` (5 tests): delete then Undo is byte-identical, `Ctrl+Z` in the panel, refusal after a hand edit, five operations then History restores the third and then the text before the first, History and Undo per query.

#### Deviations
- Undo is a button in the steps panel head, not in the status region: the status bar has no slot for an action.
- A view sort in the column menu is not built. The menu's Sort entries are the grid's own display sort, which keeps the original row numbers and works to 200 000 rows; a worker sort would renumber the rows and replace it for no gain. `view` still accepts a `sort` and it is unit tested, so it can be wired later.
- The steps panel head wraps if it runs out of room; History stays hidden until there is something in it so the panel looks the same as before for a query nobody has edited (no visual baseline changed).

#### Not done in WB-14 and WB-15 (still)
- Peek, pin a step, Invoke for function queries, delta chips beyond row counts, the Count rows setting, the multi-step preview popover, Auto-run steps after structural edits, the editor gutter band.

### WB-14, WB-15: delta chips, peek, Pin a step, Count rows and Auto-run settings
- `src/core/wb/step-delta.js` (pure): `shapeOf` takes a step's preview result, `stepDelta(prev, cur)` compares it with the previous table step, `schemaChange` counts added, removed and renamed columns (a rename is a column that changed name in place) and changed types, `rowsCountable` applies the setting and `limits.stepCountRows` (2 000 000, new in `limits.js`). 9 unit tests.
- Steps panel chips: the first table step shows its row count; each later step shows what it changed, rows first (`−312 rows`), then `+1 col`, `−2 cols`, `renamed 2`, `3 types`, at most two on the chip and all of them in its title; `schema same` when nothing changed; a list shows `list 14`, other values their kind. A step that did not run shows nothing.
- Peek: hovering or focusing a step for 400 ms shows a tooltip (not interactive, `aria-describedby` on the row, closed by leaving, Escape, a click or a re-render) with the step's column names and types and its first five rows, and `N more rows`. It reads the preview the step already carries, so it asks the worker for nothing and never moves the cursor. Lists and other values have no peek.
- Pin a step: the step's actions menu has Pin this result (disabled unless the step ran and its result is a table). It pins that step's own result id, whichever result is shown, and pinning the same one twice does nothing. `pinCurrent` and `pinStep` share `pinEntry`.
- Settings dialog: Count rows for every step (default on; off, or a step over the limit, shows `rows not counted` and reports only schema changes) and Run the steps again after structural edits (default off; every `applySteps` operation, Undo and a restore from History then run the steps; Add as a step and Add as steps already run to the new step themselves, so they skip it). A settings change refreshes the steps panel at once.
- Tests: `tests/e2e/step-delta.spec.js` (9: the full chip sequence on a seven step query, two changes at once with the title, hover and focus peek, no peek for a list, Pin this result and its dedupe, disabled for a list, Count rows off, Auto-run off and on) and `tests/unit/wb-step-delta.test.js`. The four `09-settings-dialog` baselines were regenerated after looking at them (two new checkboxes).

#### Deviations
- Row counts are known without any extra work in this engine (a table is materialised), so Count rows only decides what is shown; it does not skip any work.
- Only the first two parts of a chip are shown on the row, to keep it short.
- Like the other settings, these two are not remembered between sessions (the dialog already says only the theme is).

#### Not done in WB-14 and WB-15 (still)
- Invoke for function queries, the multi-step preview popover (Apply and Cancel), the editor gutter band.

### WB-10: layout presets and the More menu
- `src/core/wb/layout-presets.js` (pure): Write (navigator and editor, inspector and dock collapsed), Debug (navigator collapsed, steps open, dock open at 50 % on Result), Review (navigator and steps collapsed, dock open at 70 % on Changes); `dockSplit` clamps the dock to 15 to 85 %. 3 unit tests.
- `Workspace.applyPreset` moves each pane to the wanted state through the existing toggles (so focus and rails behave as they do by key), sets the editor and dock split through the same custom properties the splitter uses, and shows the wanted dock tab. At 1099 px and narrower the presets are not offered (the layout is already one region at a time): the menu items are disabled and the palette command says so in the status line. Sizes stay in memory.
- Top bar: a More actions button (⋯) after Export, hidden until a workbook is open and hidden below 700 px (there is no room for it beside the file name; the Download popover still has Review changes there). Its menu has Layout (Write, Debug, Review) and Changes (Review N changes, which opens the Changes tab, and Revert all changes, which asks first); both Changes items are disabled when nothing has changed.
- Palette: Layout: write, Layout: debug, Layout: review and Show the Changes tab.
- Tests: `tests/e2e/layout-presets.spec.js` (7). Visual baselines: the nine 390 wide ones were unaffected once the button is hidden there; the twenty 1280 wide ones were regenerated (checked with a crop of the top bar and the open menu) because the button is now in every one.

#### Deviations
- Run is not moved into the top bar. It sits in the run bar beside the editor with its dropdown, and it is already the only filled button on screen; moving it would leave two Run buttons or touch every test that finds it by name.
- There is no Changes split button. The Download button keeps its count; Review changes and Revert all are in the More menu, the palette and the Changes tab.
- No Sources entry in the More menu yet (WB-19).

### WB-19: the Sources dialog and the up-front check
- `unboundFor(inventory, names, boundKeys)` in `src/core/wb/sources.js`: the literal file and web sources of the given queries that have no binding, each with only the queries from that list that use it. One more unit test (11 in `wb-sources.test.js`).
- `src/ui/wb/sources-dialog.js`. The Sources dialog (More menu, Sources, and the palette command) lists every source in the section: its key or, for a computed path, "Chosen when the query runs"; its kind and call; the queries that use it; and whether a file is bound, with Choose file and Clear (each button's accessible name carries the key). A computed path says Quoin asks when the query runs; a source Quoin cannot read in the browser (database, folder, SharePoint) says that a query needing it ends with an error, and neither gets a choose button. A file that cannot be read is reported in the dialog.
- Run all, run stale, run downstream and run selected now check first (`Workspace.preflightSources`, using the run plan's own list of queries plus everything upstream of it, since evaluating a query evaluates what it reads). If any of those needs an unbound literal file or web source, one dialog lists them and offers Bind them now (opens Sources, then the run goes ahead), Run anyway (the queries that lack a file end with the source error as before and the rest of the run goes on) and Cancel (nothing runs). With every file bound the run asks nothing. A single Run of one query still asks when it reaches the source, as before.
- Tests: `tests/e2e/sources.spec.js` (8: the list and its states, bind and clear, three files bound then Run all with no dialog, Cancel, Run anyway ending with `1 failed`, Bind them now then the run, computed path and database rows, an empty list and the palette command, an upstream-only file). The Run all budget test in `budgets.spec.js` now clicks Run anyway on the new dialog and starts its timer after that click, and the More menu list in `layout-presets.spec.js` includes Sources.

#### Deviations
- The plan's `sources.xlsx` fixture does not exist; the tests write their queries into `csv-query.xlsx` and bind small CSV files made in the test.
- A single Run of one query is not checked up front; it keeps the existing ask at the source.
- Bindings are still kept only for the session and never written to the workbook.

#### Not done in WB-19 (still)
- Nothing in the plan's list; a binding for a folder or a database is not offered because the engine has no way to read one.

### beta-v2: finishing Phase 6

Work continues on the branch `beta-v2`, cut from `beta` at `95676d4`. Lint and unit on that commit, unchanged: 0 findings, 1128 pass and 5 skipped.

#### Fixed on the way
- The browser suite on the untouched `beta` tip, in a 2-CPU sandbox: 285 passed and 4 failed, not the 289 and 0 recorded above. All four tests read the page before the effect they assert had landed; nothing in the app changed. `column-tools.spec.js` (Add as a step read the grid before the view was applied; it now waits for the view chip), `steps-panel.spec.js` (the rewiring move read the editor before the confirm dialog's `close` event had run the transform; it now waits for the moved row), `store.spec.js` (the batch was cancelled 600 ms after it started, but the "slow" member reaches the row cap in about 250 ms here, so the batch had already finished; it now cancels as soon as the first member result arrives) and `palette.spec.js` (the `#` test had the same 0 ms timer race as the `:` test above; it is polled the same way). No expectation changed. The four specs passed 7 runs out of 7 afterwards.

