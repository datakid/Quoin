# Lane: scope

You are the Scope agent, working in your own session on branch `fable-scope`. This brief is the integrator's answer to `MESSAGES-scope.md` (the section "second merge") and to `HANDOVER-scope.md`. Read `docs/fable/OWNERSHIP.md` first; it applies to you. Your row is in `docs/fable/ownership.json` under `scope`.

## How you work

- Branch: `fable-scope` only. First `git fetch origin && git merge origin/fable` (never rebase, never force-push, no new branches). Push `fable-scope` after every task commit. The integrator merges it into `fable`.
- Commit subjects short, git style. Trailer lines as in OWNERSHIP.md rule 5 (leave out `Claude-Session` if your session has no URL).
- No code comments. Lint 0 and unit 0 failures before every push.
- Notes: `docs/fable/lanes/NOTES-scope.md` (create it) and your `MESSAGES-scope.md`. Last line of the notes when you stop: `HAND BACK <commit hash>`.
- Never wait for the integrator. Work the queue below from top to bottom. An item that needs a file you do not own gets the exact change written in your notes and you move to the next item.

## Your files

The `scope` row in `docs/fable/ownership.json`: `src/batch/resolve/**`, `src/core/snapshot.js`, `src/core/export/xlsx.js` and `limits.js`, `src/batch/execute/units.js`, `transform.js`, `combine.js`, `excel-compute.js`, `scripts/make-excel-pack-scope.mjs`, `tests/fixtures/generators/worked-example.js`, your tests (`batch-resolve*`, `batch-scope`, `batch-tokens`, `batch-units`, `batch-chain`, `batch-transform`, `batch-combined`, `batch-contract`, `batch-worked-example`, `excel-pack-scope`, `export`, `export-*`), your progress, messages, handover and remaining-work files.

Not yours: `src/core/save.js` and `src/core/sheet/**` and the `sheet-*` and `batch-naming` tests (the safety lane owns them now), `src/batch/execute/index.js`, `collect.js`, `run-file.js`, `src/batch/recipe/**`, `src/app/**`, `src/ui/**`, workers, `strings.js`, the manifest, `tests/e2e/**`, `tests/unit/outputs.test.js`.

## Decisions on your questions

The user answered yes to D1 to D6 in `REMAINING-WORK-scope.md`. So D1 (tokens in injected text), D3 (`skipped / skip.missingColumn`) and the real-Excel run by the user are settled. D4 stands: in place stays held until X03 passes in desktop Excel. D5: CI is the evidence for Firefox and WebKit.

1. F3-08 and F3-09. Neither goes to `fable`. Your answer is a mix of your options (a) and (b): your branch gets a new commit after which the tree is `fable` plus your row files, with no in-place and no Excel-compute code. The earlier commits (`c15016d`, `aeb32f6` and the rest) stay in your branch history, so the work is not lost and can come back when D4 allows it. The integrator then merges `fable-scope` (or squashes it).
2. Your lane items from `HANDOVER-scope.md`:
   - item 1 (`save.js`, `sheet/**`): take `fable`'s version of every file there, and delete the files `fable` does not have (`write-ranges.js`, `styles.js`, the `sheet-*` tests, `batch-naming`). The safety lane builds the F3-11 insertion check on `fable` with the `<numFmts>` false refusal (Writer's finding 5) already fixed, reading your `49d0ceb` and `sheet-selfcheck.test.js` from your branch history.
   - item 2 (`execute/index.js`): the one exception. Your tree may carry the import of `withInjectTokens` and the single line `recipe = withInjectTokens(recipe, meta)` and nothing else in that file. Write the exact lines in your notes; the integrator merges them next to Writer's three lines.
   - item 3 (`export/xlsx.js`): keep, it is in your row now. Keep `outputs.test.js` as `fable` has it and write the one assertion you changed in your notes; the integrator applies it.
   - item 4 (`resolve/tokens.js`): keep, it is in `resolve/**`.
   - item 5 (`tests/e2e/fable-worked-example.spec.js`): take `fable`'s version and write your three-line change in your notes. The integrator applies it and runs the spec.
   - item 7 (`make-excel-pack-scope.mjs`): keep, it is in your row.
3. Branch: you push only `fable-scope`, as you have. No new branch.

## Queue

1. The clean tree. `git merge origin/fable`. Run `node scripts/check-ownership.mjs lane scope origin/fable` and put every foreign file back as item 2 says. Remove the `allowInPlace` path and the write-ranges calls, and the whole Excel-compute path (`excel-compute.js`, its test, the `compute` handling in `resolve.js` and `transform.js`), following `PROGRESS-scope.md`. A recipe that asks for in place or for Excel compute must produce a `refused` row, not a crash: say in the notes which refusal codes you use. The commit message names what was taken out. Lint 0, unit 0 failures on this tree. Push. This is the item the integrator is waiting for, so it comes first and alone.
2. Strings. In the notes, a table of every code in section 6 of `REMAINING-WORK-scope.md` that your tree now emits, with the English text for the person, one short sentence each, in the style of `src/ui/strings.js` (read it first). Drop the codes of the removed paths. The integrator adds them in one pass.
3. The worked example. Check that `batch-worked-example.test.js` asserts every number of Fable section 9: 13 units, 10 workbooks, 11 changed, 2 skipped. Write the exact Preview note text and the report counts in the notes, so the integrator can make `fable-worked-example.spec.js` match.
4. Audit of `src/batch/resolve/**` and `units.js`: every `planning error` and refusal code in a table in the notes with the test that reaches it. For a code with no test, add one. Then break each once on purpose (edit, run that test file, `git checkout` the edit) and record that a test fails.
5. The decisions text for `docs/decisions.md` (plan P11): in the notes, a short section for each of D1, D3, the chain and unit semantics, and output naming, in the words of the user's decisions. Nothing about in place except that it is held and why.
6. When 1 to 5 are done, write the notes and `HAND BACK <hash>`. Stop.

## Ruled out

- Anything in `save.js` or `sheet/**`, even to make one of your tests pass: write the change in your notes.
- Releasing in place or Excel compute in any form, including behind a flag.
- Marking anything verified in Excel. Pack 1 is "opened without repair, queries and VBA ran, outputs not reviewed".
- Editing a file outside your row, except the two lines in `execute/index.js` named above.
