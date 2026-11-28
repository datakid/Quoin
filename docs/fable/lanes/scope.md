# Lane: scope

You are the Scope agent, working in your own session on branch `fable-scope`. This brief is the integrator's answer to `MESSAGES-scope.md` (the section "second merge") and to `HANDOVER-scope.md`. Read `docs/fable/OWNERSHIP.md` first; it applies to you. Your row is in `docs/fable/ownership.json` under `scope`.

If you are starting in a new chat: read `docs/fable/AGENTS.md` first (section "Picking up in a new chat"), then this brief, then the `## State` block at the top of `docs/fable/lanes/NOTES-scope.md`. Keep that block current at every push, in the format AGENTS.md gives. Continue at the first milestone below that the notes do not mark done.

The quality bar is in `docs/fable/AGENTS.md` ("The quality bar for every agent"): evidence for every milestone, every new test shown to fail without its change, no weakened test, Firefox and WebKit fixed only when CI says so. The integrator sends back work that does not meet it.

## How you work

- Branch: `fable-scope` only. First `git fetch origin && git merge origin/fable` (never rebase, never force-push, no new branches). Push `fable-scope` after every task commit. The integrator merges it into `fable`.
- Commit subjects short, git style. Trailer lines as in OWNERSHIP.md rule 5 (leave out `Claude-Session` if your session has no URL).
- No code comments. Lint 0 and unit 0 failures before every push.
- Notes: `docs/fable/lanes/NOTES-scope.md` (create it) and your `MESSAGES-scope.md`. Last line of the notes when you stop: `HAND BACK <commit hash>`.
- Never wait for the integrator. Work the queue below from top to bottom. An item that needs a file you do not own gets the exact change written in your notes and you move to the next item.

## Your files

The `scope` row in `docs/fable/ownership.json`: `src/batch/resolve/**`, `src/core/snapshot.js`, `src/core/export/xlsx.js` and `limits.js`, `src/batch/execute/units.js`, `transform.js`, `combine.js`, `excel-compute.js`, `scripts/make-excel-pack-scope.mjs`, `tests/fixtures/generators/worked-example.js`, `src/core/save.js` and `src/core/sheet/**` with the `sheet-*`, `save-safety` and `batch-naming` tests (moved to you on 2026-11-27: the safety lane never ran), your tests (`batch-resolve*`, `batch-scope`, `batch-tokens`, `batch-units`, `batch-chain`, `batch-transform*`, `batch-combined`, `batch-contract`, `batch-worked-example`, `excel-pack-scope`, `export`, `export-*`), your progress, messages, handover and remaining-work files.

Not yours: `src/batch/execute/index.js`, `collect.js`, `run-file.js`, `src/batch/recipe/**`, `src/app/**`, `src/ui/**`, workers, `strings.js`, the manifest, `tests/e2e/**`, `tests/unit/outputs.test.js`.

## Decisions on your questions

The user answered yes to D1 to D6 in `REMAINING-WORK-scope.md`. So D1 (tokens in injected text), D3 (`skipped / skip.missingColumn`) and the real-Excel run by the user are settled. D4 stands: in place stays held until X03 passes in desktop Excel. D5: CI is the evidence for Firefox and WebKit.

1. F3-08 and F3-09. Neither goes to `fable`. Your answer is a mix of your options (a) and (b): your branch gets a new commit after which the tree is `fable` plus your row files, with no in-place and no Excel-compute code. The earlier commits (`c15016d`, `aeb32f6` and the rest) stay in your branch history, so the work is not lost and can come back when D4 allows it. The integrator then merges `fable-scope` (or squashes it).
2. Your lane items from `HANDOVER-scope.md`:
   - item 1 (`save.js`, `sheet/**`): done on `fable`. They are yours again, for milestone S1 below. Never bring `write-ranges.js`, `styles.js` or `allowInPlace` back.
   - item 2 (`execute/index.js`): the one exception. Your tree may carry the import of `withInjectTokens` and the single line `recipe = withInjectTokens(recipe, meta)` and nothing else in that file. Write the exact lines in your notes; the integrator merges them next to Writer's three lines.
   - item 3 (`export/xlsx.js`): keep, it is in your row now. Keep `outputs.test.js` as `fable` has it and write the one assertion you changed in your notes; the integrator applies it.
   - item 4 (`resolve/tokens.js`): keep, it is in `resolve/**`.
   - item 5 (`tests/e2e/fable-worked-example.spec.js`): take `fable`'s version and write your three-line change in your notes. The integrator applies it and runs the spec.
   - item 7 (`make-excel-pack-scope.mjs`): keep, it is in your row.
3. Branch: you push only `fable-scope`, as you have. No new branch.

## Milestones (replace the old queue; work them in this order, do not wait for me)

Each milestone has a deliverable you can show and a test that proves it. Push `fable-scope` at the end of each milestone and add one line to `docs/fable/lanes/NOTES-scope.md` (milestone, commit, evidence). Dependencies are stated: when a milestone is blocked by another owner, do the next one and come back.

**S1. The sheet-write trust gate (F3-11). You own `src/core/save.js` and `src/core/sheet/**` now.** Writer's review findings 1, 2 and 5 and your own finding on sheet names are all here, so the work has one owner. The spec is `docs/fable/lanes/safety.md` (read it fully; ignore "lane", "safety lane" and "clone": you work on `fable-scope`). Deliverables:
- the declared-insertions check on `fable` (`addSheetsToPackage` returns `texts` and `insertions`; `selfCheck` verifies that each touched part is the original plus only what was declared), built on `fable`'s files, with the `<numFmts>` false refusal (finding 5) fixed from the start; no `write-ranges.js`, no `styles.js`, no `allowInPlace`; `refuseUnapplied` stays as it is
- Writer's nine probes from `docs/fable/excel-pack/repro-sheet-gap.mjs` as a unit test through `applyChangeSet`, plus the three regression cases of the Gemini draft in `docs/fable/lanes/draft-gemini-sheet-no-numfmts.test.js` (comments stripped)
- `MESSAGES-writer.md` findings 2 (read it) and the UTF-16 sheet-name cut in `names.js`, with emoji tests for the base name, the `-2` suffix and `combine.js`
- the mutation proof: every new check broken once on purpose and a test fails
- Acceptance: unit 0 failures, lint 0, `node scripts/check-ownership.mjs lane scope origin/fable` prints `all owned`. Writer reviews this when merged, so push it as soon as it is green and say so in `MESSAGES-scope.md`.

**S2. Transform over the whole fixture corpus.** Run all three output modes (a new file per unit, a new sheet in a copy, one combined workbook) over every workbook in `tests/fixtures` (XlsxWriter, Excel-made, macro-enabled, tables with dates, percentages, long text, empty tables, a table at the row limit) with scope rules and pins. For each output: it reopens with Quoin's own reader, `verify` accepts it, row and column counts match the source, number formats and date serials survive, names are unique, at most 31 UTF-16 units, and no output exists for a refused or skipped unit. New file `tests/unit/batch-transform-corpus.test.js`. Every defect this finds is fixed in your files or written into the notes as an exact request. Acceptance: the corpus test passes, and the notes list how many fixture-and-mode pairs were run and what it found.

**S3. Resolve properties.** A seeded generator of random recipes (scope rules, pins, tokens, naming templates, chain order) over random indexes, with invariants: the same input gives the same plan; the unit count equals the sum of per-file units; no two outputs share a name; no output name has a path separator, a control character or a reserved Windows name; every name is within limits; no unit appears twice. New file `tests/unit/batch-resolve-properties.test.js`, 500 seeded cases, the seed printed in any failure. Acceptance: passes, and breaking each invariant in `resolve/**` once makes it fail.

**S4. Scale.** Grow `tests/fixtures/generators/worked-example.js` to take a size, and add `tests/unit/batch-scale.test.js`: 300 workbooks and 1,200 units through resolve and execute with a stop signal fired in the middle: no partial output, the report accounts for every unit, the order is stable, memory ceiling holds as in `docs/fable/performance.md`. Acceptance: passes within the time budget of the unit suite (under 30 seconds added).

**S5. Close the loop.** `docs/fable/lanes/NOTES-scope.md`: the decisions text for `docs/decisions.md` (plan P11) for D1, D3, chains, naming, and what S1 changed; the strings table for the codes your tree emits; the list of everything you found in S2 to S4 that belongs to another owner, as exact requests. Then `HAND BACK <hash>`.

Blocked and not yours to unblock: real Excel for both packs, F3-08 and F3-09 until X03 passes, section 9 decision 2.

## Ruled out

- Releasing in place or Excel compute in any form, including behind a flag.
- Marking anything verified in Excel. Pack 1 is "opened without repair, queries and VBA ran, outputs not reviewed".
- Editing a file outside your row, except the two lines in `execute/index.js` named above.
