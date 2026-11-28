# Lane: docs

Agent: the trunk agent, on branch `fable-trunk-handover`, after milestone U5 of `lanes/ui.md`. Plan part: F5-05 (README and decisions) and F5-06 (final gate). You write what the product is, what differs from the spec, and what is proven. You change no code and no test.

Read `docs/fable/OWNERSHIP.md` and `docs/fable/ROADMAP.md` first. Their rules apply to you in full. Branch rules are the ones in `lanes/ui.md`: your own existing branch, merge `origin/fable` before each push, never rebase or force-push, no new branch, push after each milestone.

The rule of this lane: a sentence goes into a file only if you checked it against the code or a test or a recorded run. If you cannot check it, the sentence says "not verified" or it is left out. Nothing about real Excel is written as true except what `docs/observations.md` records. Section 10 of the plan is the standard, and the user's decisions in section 9 are not yours to make.

## Your files

- `README.md`
- `docs/decisions.md`
- `docs/fable/FINAL-GATE.md` (new)
- `docs/fable/lanes/NOTES-docs.md` (your notes; the ui lane has its own notes file)

Not yours, read only: everything else. A mistake you find in code, a test or another doc is written into your notes with the file, the line and the exact change.

## Inputs

- `docs/fable/01_PLAN.md`: section 3 (decisions), section 4 (stop gates), section 8 phase F4 and F5, section 9 (gates), section 10 (done list), appendices A to C.
- `docs/fable/PROGRESS.md`, `MANAGER.md`, `HANDOVER.md`, `handover/**`.
- Lane notes as they appear on `fable`: `lanes/NOTES-scope.md`, `lanes/NOTES-writer.md`, `lanes/NOTES-ui.md`, `lanes/NOTES-harness.md`. Scope milestone S5 and Writer milestone W5 end with decision text and a table of checks and tests. Take them as input, check them, then use them.
- The code and the tests. They are the truth when a document disagrees with them.

## Milestones (in order, do not wait for me)

**D1. README.** Rewrite `README.md` so it describes `fable`: what each screen does, the entry paths (single file, folder, recipe), the output modes and what each guarantees, the report and its columns, what is refused and the error codes the person sees, the storage keys (read the allowlist in `tests/lint/checks.js` and the keys in `src/`; list exactly those), the limits (rows, files, sizes, sheet names, timeouts; read each number from the code), and what has not been run in real Excel. Keep what is still true of the `beta` text. For every claim, write one line in your notes: the claim, the file or test that proves it. A claim without a line is removed.

**D2. `docs/decisions.md`.** One entry for every place where the build differs from the spec or from the plan, and for every choice the plan left open. Start from the 9 entries that exist, then add: the decisions D1 to D6 the user made (`MANAGER.md` and `PROGRESS.md` record them), Scope's S5 text, Writer's W5 text, the squash of the Scope branch (F3-08 and F3-09 kept out on purpose), the ownership model, the ui lane's engine findings (Firefox scroll height, WebKit virtualisation), and each Blocked item with its reason. Each entry: what, why, what was rejected, where it is tested.

**D3. `docs/fable/FINAL-GATE.md`.** Section 9 and section 10 as tables, one row per checkbox: the box, the state (`done`, `open: <reason>`, `user: <what>`), and the evidence (command and result, spec name, run id, file). For "every new test was shown to fail without its change", "no existing test was weakened, skipped or deleted" and "no new storage key" check by reading `git log` and `git diff origin/beta...origin/fable` on the test files and the storage allowlist, and write what you ran. Rows that depend on the user are marked so and are not guessed. Last row of the file: the list of what the user must still do to close Fable, in the order that closes the most.

**D4. Prepared text for the Excel sitting.** `docs/observations.md` and the README line "has not been run against real Excel" change only as far as results justify. You do not edit `docs/observations.md` (integrator). Write into your notes the exact replacement text for each outcome of the sitting (all pass; some fail, by case), so the integrator applies it the day `RESULTS.csv` comes back.

When D4 is done, write `HAND BACK <hash>` in the notes. If nothing is left, say so; do not stop earlier.

## Ruled out

- Editing code, tests, `asset-manifest.json`, `docs/observations.md`, `PROGRESS.md`, `MANAGER.md`.
- A claim of correctness in real Excel that `docs/observations.md` does not record.
- Marking a gate `done` without evidence you ran or read.
- Writing the user's section 9 decisions for them.

## Done

- Every claim in `README.md` has a line in the notes that points at code or a test.
- `docs/decisions.md` has an entry for each deviation, each user decision and each Blocked item.
- `docs/fable/FINAL-GATE.md` has every row of sections 9 and 10 with evidence or an open reason.
- Lint 0, unit 0 failures, `node scripts/check-ownership.mjs lane docs` prints `all owned`.
- Notes file written, last line `HAND BACK <commit hash>`.
