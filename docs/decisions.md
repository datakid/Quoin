# Decisions

Each entry records a place where the build differs from `docs/QUOIN_SPEC.md`, or where the spec left a choice open, with the reason.

## 1. A small XML scanner instead of `DOMParser`

The spec names `DOMParser` for XML. Quoin uses its own scanner in `src/core/xml.js`. Reasons: it runs in Node, so every part of the core is unit-tested without a browser; it records the byte span of every element and attribute, so edits are made as text splices and everything else in the part stays byte-for-byte identical (declaration, namespaces, attribute order, `mc:Ignorable`); and the same tokenizer streams large sheets. DOCTYPE and ENTITY are rejected before parsing, as the spec requires.

## 2. Operator precedence of `meta`

The spec's precedence list puts `meta` lowest. The official M grammar puts it between unary and multiplicative operators, and `as` and `is` below equality. The parser follows the official grammar, because queries written for Excel assume it.

## 3. `pq.trailing` and `pq.version` are warnings

Spec DM-1 says trailing bytes give an error, while S-4 and T-PQ-5 say reading still works and only writing is blocked. The parser records a warning, reading proceeds, and writeback refuses. Length overflow still throws `pq.length`.

## 4. Edits are trimmed at both ends

A query's expression span excludes surrounding whitespace, so a trailing newline typed in the editor cannot be stored. The editor text is trimmed at both ends before it is compared or written, and a difference in whitespace alone is not an edit. If the edit ends inside a `//` comment, a line break is added before the member's closing `;`, otherwise the terminator would become part of the comment.

## 5. Binding requests re-run the query

The spec has the worker pause and wait for a file. A synchronous interpreter cannot wait without `SharedArrayBuffer`, which needs cross-origin isolation headers that static hosts rarely send. The interpreter stops with a `NeedBinding` signal, the host asks for the file, and the run starts again with the binding in place. The result is the same for the user.

## 6. Time values

Date-times and durations hold their ticks as `BigInt`, because 100 ns ticks since year 1 exceed 2^53. Dates hold a day count and times hold ticks within a day as numbers.

## 7. Final partial OVBA chunk

A final chunk shorter than 4096 bytes that does not compress below 4096 bytes cannot be written as a raw chunk without zero padding. Source text never behaves like this, but the writer decompresses its own output and compares it with the input, and refuses to write if they differ.

## 8. Fonts

Atkinson Hyperlegible Next and Commit Mono come from the `@fontsource` packages (SIL Open Font License). The licence texts are in `public/fonts/`.

## 9. Fixtures

The spec asks for fixtures made in real Excel. No Excel was available. The fixtures are real Excel-saved files from public repositories (see `tests/fixtures/external/NOTICE.md`) plus synthetic variants produced by `tests/fixtures/generators/build.js`. Synthetic files are marked as such in `tests/fixtures/workbooks/README.md`. F-MIXED has three modules, not four.

## 10. Browser coverage

The spec asks for Chromium, Firefox, and WebKit. Only Chromium was available. The code uses standard APIs only (`CompressionStream`, `DecompressionStream`, module workers, `<dialog>`), but Firefox and WebKit runs are outstanding.

## 11. `frame-ancestors`

Browsers ignore `frame-ancestors` in a meta tag and log a console error. The meta policy omits it; `_headers` carries the full policy.

## 12. Rounding functions

`Number.RoundUp`, `RoundDown`, `RoundTowardZero` and `RoundAwayFromZero` are directed (ceiling, floor, truncate, away from zero), matching their documented examples. `RoundingMode.AwayFromZero` inside `Number.Round` rounds halves away from zero, which is how it is used in practice. The default mode is `ToEven`, as documented, and is on the list of things to confirm in Excel.

## 13. Cells in tables may hold unevaluated values

Table cells can hold lazy values so that one failing cell does not fail the table. `cell()` forces them. Any code that reads a table cell goes through it.

## 14. Not built

The lexer fuzz test runs 1,000 seeds of 4 KB and a few seeds of 1 MB, not 1,000 seeds of 1 MB.

## 15. What counts as a change

Query text is compared after trimming both ends through `normalizeQueryText` in `src/core/pq/section.js`; the session and the writer share that one function. VBA module text is compared exactly, without trimming, because leading whitespace and trailing blank lines are significant in a module.

## 16. Identity

The name stays quoin. The mark is a square ring with a solid sodium block replacing the bottom-right corner (`public/mark.svg`, `public/mark-dark.svg`, `public/favicon.svg`, `public/icon-maskable.svg`). The app embeds the mark with `<img>`, which cannot inherit `currentColor`, so there are two files with the ring in ink and in bone, and `src/ui/mark.js` swaps the `src` when the theme (explicit choice or system scheme) changes. `favicon.svg` is the only file with a `<style>` element: an SVG used as a favicon is a separate document, so the page policy does not apply to it, and the block inside follows the operating system colour scheme.

## 17. Palette and tokens

`styles/tokens.css` holds the ground, sodium, cobalt, minium and patina sets from `docs/next/02_IDENTITY.md`. Differences from that document, each forced by the contrast test or by the existing code:
- `--tide` is gone; its two roles fold into `--cobalt-ink` and `--cobalt-soft`.
- `--marker` is new: the selected-row bar. Sodium on the light grounds is about 1.5:1, so light uses the dark gold of `--sodium-ink` and dark uses sodium.
- `--readout-alert` is new: error text on the inverted status strip, which is dark in both themes, so `--minium-ink` cannot be used there.
- Dark `--line-strong` is `#5B6760` instead of `#4A544E` to reach 3:1 on both dark grounds.
- Radii are rounder than the document (8, 12, 16 and 22 px) and a pill radius is added; `--font-code` keeps Commit Mono; type tokens keep their existing split of size and line height.
- The sodium fill of the primary button is not paired for boundary contrast: the label is paired at well above 4.5:1 and the button is identified by its text.

## 18. Layout below 1024 px

The rail becomes a sheet opened from an Items button in the item header; selecting an item closes it. Below 700 px the wordmark and file size are hidden; below 640 px the Code and Result switch is shown and the Run bar stays visible in both panes. The grid rows of the main column are assigned explicitly so that a visible information strip cannot push the editor into the wrong row.

## 19. Visual baselines

`tests/__visual__` holds 36 baselines (nine states, two sizes, two themes) from Chromium on Linux with reduced motion and the status strip masked where it shows a duration. They are not platform-suffixed, so a different operating system will show small font-rendering differences; regenerate them with `npx playwright test tests/e2e/visual.spec.js --update-snapshots` after checking the screenshots by eye.

## 20. One line differ

`src/core/diff.js` holds the longest-common-subsequence matcher that `module-source.js` already used to place hidden `Attribute` lines, now shared with the Changes view and the printed diff. Above four million line pairs the middle of the text is not matched and shows as removed and added; the shared prefix and suffix are always matched.

## 21. Saving

When the browser offers `showSaveFilePicker` the workbook is written through it, read back from the handle and compared byte for byte before the status says it was saved; a mismatch is reported as `write.verify` and nothing is called saved. If the chosen entry is the file that was dropped in (known only when the browser gives a handle for a drop), a dialog asks before the original is replaced. Elsewhere the file goes through an `<a download>` and the status says only that it was downloaded. The feature is detected, never inferred from the user agent.

When a digital signature is removed on save, the rewritten `[Content_Types].xml` is written first and the signature parts and `vbaProject.bin.rels` are dropped; every other entry keeps its position and its original compressed bytes.

## 22. Printing: we own the pagination

A browser cannot repeat a footer row at the bottom of every printed page, cannot print page numbers (CSS margin boxes are not implemented in any shipping browser), cannot report the page count and cannot read the paper or orientation chosen in the print dialog. quoin therefore builds the pages itself: `src/core/print/layout.js` decides how many rows fit (pure, unit-tested in Node), `src/ui/print-render.js` builds one `.print-page` element per page with its own running head, repeated rows and a `Page N of M` foot, and the browser only has to put each element on one sheet.

- Lengths in the layout are integers in tenths of a millimetre. A page element is 0.5 mm shorter than the sheet so that rounding never pushes a blank page behind it.
- `@page` cannot read a custom property or a class. Paper and orientation are twelve named pages (`@page a4-landscape { size: A4 landscape; margin: 0 }`) selected through the `page` property on `.print-page`; margins are padding on the page element, so they are exact. A browser that ignores the `page` property prints on the default sheet and the panel says that the print dialog can override the choice.
- One stylesheet, `styles/print.css`, linked for all media: the preview on screen and the printed output share the same classes.
- Chosen rows per page win over the fit calculation. When the chosen number cannot fit at full height, the rows of that table are drawn smaller and the panel says by how much; nothing is clipped.
- Repeated first rows and last rows are taken out of the body and drawn on every page; row numbers stay true. The header is a real `<thead>`.
- Wide tables are split into column bands, printed band by band, each with the index column and the chosen sticky columns.
- Code is wrapped in `src/core/print/code-lines.js`; a wrapped continuation has a blank gutter and a hanging indent, so numbers stay true. Printed pages use light-theme colours on white paper whatever the app theme is.
- Above 20,000 rows the preview asks first and above 200,000 rows it refuses; both limits are in `src/core/limits.js`. Pages are built 25 at a time between animation frames.
- A print started from the browser menu without the preview (`beforeprint`) prints the open item's code, or its result when every row is already in memory.
- Fit columns to width is not offered; scale (60 to 140 percent) and column bands cover the same need.

## 23. Not built, so nobody tries it later

No PDF library in the app (the browser's Save as PDF is the supported route and G-6 forbids a dependency); no control over the file name of a printed PDF; no duplex, tray, copies or printer choice; no CSS margin boxes; no replacement for the browser's own headers and footers (the panel tells the user to turn them off).

## 24. Fable: a set of files, a worker pool and a set shell

These entries cover the Fable branch (`fable`, cut from `beta`). The plan is `docs/fable/01_PLAN.md` and progress is `docs/fable/PROGRESS.md`.

- Batch code lives in `src/batch/` and may import only `src/core/` and itself; workers import `src/core/` and `src/batch/`; the UI imports `src/ui/` and `src/core/`, with one named exception (`src/ui/wb/steps-panel.js` imports `matches` from `src/app/commands.js`). Lint rules T-LINT-18 to T-LINT-20 enforce the direction, keep DOM and worker globals out of `src/batch/`, and keep base64 helpers inside `src/core/`.
- The worker protocol for open, inspect, apply, cancel and progress is a set of pure message constructors and a validator in `src/batch/protocol.js`. A result buffer must own its whole `ArrayBuffer`, so transferring it cannot detach another view.
- A file index (`src/batch/index/`) is built from `openWorkbook`. A name that is a lock file or has an unsupported extension is refused before any bytes are read, on the main thread and again in the worker.
- Workers are pooled (`src/app/pool.js`): size `min(4, max(1, cores - 1))`, at most 2 on devices that report 4 GB or less; admission by an in-flight byte budget (768 MiB, or 384 MiB on those devices); a job larger than the budget runs alone; jobs queue in relative-path order. A worker that does not acknowledge a cancel within 1000 ms is terminated and replaced. The interactive `Runner` leases its own worker from the pool.
- A set (`src/app/set-session.js`) is a state machine with one active move at a time. A single dropped workbook still opens the workspace. With no workbook open, two or more files or a folder create a set; with a workbook open they are refused as before, so unsaved edits are never replaced.
- The set shell shows Files, Recipe and Result regions and a run bar. The start screen is unchanged.
- The `.github/workflows/ci.yml` workflow runs lint, unit and browser tests on every push to `fable`, and condenses the results into check annotations.

## 25. Fable Phase F1: Collect and Variants (read only)

- A recipe is data. `src/batch/recipe/recipe.js` parses the JSON of Appendix A with defaults, warns on unknown fields and on blocks that belong to another recipe kind, refuses newer versions, and serialises to one canonical form. Nothing in a recipe is evaluated.
- The resolver (`src/batch/resolve/resolve.js`) is pure: a recipe, the file indexes and a frozen time give a plan, independent of input order. Collect makes one workbook unit per usable file with one action per query and per module.
- Collect output equals the single-file "everything" zip byte for byte, because the worker uses the same `queryFile`, `moduleFile` and `zipFiles` and reads the zip back before releasing it. Every writer takes a frozen time, and the zip clock is built from its UTC parts, so the bytes do not depend on the machine's time zone.
- The Collect zip holds `index.xlsx`, `report.csv` and one folder per file that produced output, named after its path without the extension (`-2`, `-3` on collisions, compared without regard to case). `report.csv` carries timings, so it is the one entry that differs between two runs of the same set. A run over 1 GiB of compressed outputs or 65,534 entries is refused with `output.zipTooLarge`.
- The result table reuses the virtualised grid. A verdict is always a word; colour only adds to it.
- The Versions panel groups names by content hash; its diff text comes from running a Collect on one file through the worker pool, so no parsing happens on the main thread and the worker protocol did not change.
- "Read only" is tested: a run that spies on every file system write API sees no call, and the dropped files are byte-identical afterwards (`tests/e2e/fable-readonly.spec.js`).

## 26. Fable Phase F2: Inject and Replace

- A batch is three steps. The resolver turns a recipe and the set into a plan. The runner executes the plan. The report is read from the plan after the run. Preview and Get run the same executor with the same frozen time, so the bytes Preview describes are the bytes Get writes. A difference is `verify.planDrift`: that file is not released, its row reads not released, and the run is flagged.
- Preview never keeps bytes and a run never keeps text. `apply` takes `includeTexts` only in a preview and returns the before and after text of each query and module change, which feeds the per-row diff. The diff reuses the line diff of the Versions panel.
- Every output is verified before it is released: the rebuilt workbook is read back and compared with the original, and only the declared adds, replaces, renames, removes and the signature part may differ. Everything else must be byte-identical. A file that fails is reported and not written.
- Folder output writes each file after it is verified and aborts the stream on error or stop. Zip output is built at the end from verified files only. Both write `report.csv` with a row for every file in the set. A source file is never opened for writing; a test spies on the write APIs to show it.
- A stopped Get leaves only complete files. The preview table comes back and a note says how many workbooks went to which folder, or that nothing was written. A second run cannot start until the stopped one has finished the file it was writing.
- Verdicts are changed, unchanged, skipped, refused, failed, cancelled and not released. A file the recipe does not apply to is skipped; a file the recipe applies to but must not change is refused with its reason in words, with the detail in brackets.
- One confirmation per set names how many workbooks have a signed macro project, because editing removes the signature. The report marks each one. This rests on an earlier "approved" and is open to change once real Excel results are in.
- Removing or renaming a query that Excel made, not Quoin, is refused for now. The same applies: it stays refused until the real-Excel pack has been checked.
- Aligning a class or document module reads the collected file back through `moduleSourceOfFile`, which undoes the export header or footer that the index hash does not include. A module with characters outside ASCII is still refused at the align check, which is safe but not yet right.
- The grid ended a drag only when the button came up inside it; a plain click left drag mode on and repainted forever once rows were re-created. A pointer entering a cell without the primary button down now ends the drag.
- On a phone the set shell scrolls and every pane is as tall as its content. Before, the three rows were squeezed into the screen and the recipe's Versions list ran over the Result pane.
- Real Excel has not opened any output. `node scripts/make-excel-pack.mjs` builds a zip of inputs, outputs and a checklist for a person to open in Excel; nothing in it is marked verified.
- Transform can write a new sheet in a copy and Preview and Get handle it (F3-06). One copy per source workbook, named `{file} (edited).{ext}` beside the source, holds every original sheet and one new sheet per unit (`Result`, `Result-2`, and so on). A report row names the copy and its sheet as `path [Sheet]`.
- The first real-Excel report (2026-11-24, from the person, not a ticked checklist): the pack's files opened without a repair message and the queries and macros ran without errors; the outputs themselves were not reviewed. The integrator took that as enough to wire new sheet (F3-06), which is a copy of a workbook that opened cleanly, and kept in place (F3-08) and Excel-computes-on-open (F3-09) held, because the pack has no case for either.
- Transform can write one combined workbook for the whole set and Preview and Get handle it (F3-07). `Combined.xlsx` has a sheet per unit in plan order and sits at the root of the zip or folder. A preview keeps only the digest of each sheet; the workbook itself is built once at run time, after every file's check against its preview, and a file that drifted is left out.
- A person can keep a recipe in two ways: in this browser (`quoin.recipes`, the recipe text only) or as a file named `{name}.quoin-recipe.json`. The home footnote now says so, because "nothing is stored" had stopped being true. Recent sets are not shown: the browser gives the page no way to reopen a folder, so a list of names would promise something the app cannot do.
- A saved recipe that cannot be read (corrupt, or from a newer version) is counted in the panel and left in storage, never deleted for the person.
