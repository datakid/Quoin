# Parallel work on Fable

The decision document is now in the repository as `docs/fable/00_FABLE.md` on `fable`. A side branch that was cut earlier gets it by merging `fable` into itself. F3-02 uses its sections 3.2 and 3.3.

Three agents work at once, each on its own branch, on files that do not overlap. Every agent reads `docs/fable/01_PLAN.md` first; the task cards there are the specification.

## Who does what

| Agent | Branch | Tasks | Who merges |
| --- | --- | --- | --- |
| Trunk (Claude) | `fable` | F0-12, F1-05, F1-06, F1-07, F1-08, then every integration task from F2-10 on | Trunk merges the other two branches |
| Writer | `fable-writer` | F2-01 to F2-09 | Trunk |
| Scope | `fable-scope` | F3-01, F3-02, F3-03, F3-04 | Trunk |

A side branch starts from the `fable` commit named in its brief and is never rebased. To get new trunk work, merge `fable` into your own branch.

## What each agent may edit

Trunk owns everything not listed for another agent: `src/app/**`, `src/ui/**`, `src/workers/**`, `src/batch/protocol.js`, `src/batch/execute/collect.js`, `src/batch/index/**`, `src/batch/recipe/**`, `src/batch/verify/**`, `src/ui/strings.js`, `tests/e2e/**`, `tests/a11y/**`, `tests/__visual__/**`, `asset-manifest.json`, `README.md`, `docs/decisions.md`, `docs/fable/PROGRESS.md`.

Writer (`fable-writer`) may edit only:
- `src/core/save.js`, `src/core/vba/**`, a new `src/core/pq/members.js`
- new files `src/batch/execute/index.js`, `changes.js`, `replace.js`, `align.js`
- new unit tests named in the task cards (`batch-save`, `batch-execute`, `batch-pq-members`, `batch-replace`, `batch-align`, `batch-vba-*`), and the existing save and VBA unit tests only as the cards say
- `tests/lint/checks.js`, only by adding T-LINT-21 as a new exported function and its wiring at the end of the file, with its tests in a new file `tests/unit/lint-rules-writer.test.js`
- its own progress file `docs/fable/PROGRESS-writer.md`

Scope (`fable-scope`) may edit only:
- `src/batch/resolve/**` (including `resolve.js`), `src/core/snapshot.js`, and a new `src/batch/execute/units.js`
- new unit tests (`batch-units`, `batch-chain`) and new cases in a new file `tests/unit/batch-scope.test.js`; do not edit `tests/unit/batch-resolve.test.js`, add to it only through trunk
- its own progress file `docs/fable/PROGRESS-scope.md`

Nobody but trunk edits: `src/ui/strings.js` (write the strings and error codes you need in your progress file, and trunk adds them when it merges), `asset-manifest.json` (do not commit it), `src/workers/m-worker.js`, `src/batch/execute/collect.js` (trunk wires your code into the worker and the dispatch), or any visual baseline.

If a task needs a file outside your list, stop and ask the user. Do not edit it.

## Interfaces between the branches

- Writer gives trunk `executeFile(wb, filePlan, {now})` returning an `ApplyResult` (section 5.3 of the plan) and `applyChangeSet(wb, changeSet, {now, refreshOnLoad, checkSection})`. Describe the ChangeSet shape in `PROGRESS-writer.md`.
- Scope keeps `resolvePlan(recipe, indexes, {now})` returning the Plan of section 5.3. New options are optional. Unit kinds grow from `workbook` to `sheet` and `table`; existing Collect behaviour must not change and the existing `batch-resolve.test.js` must keep passing.

## Rules for every agent

1. No code comments, in any form, in any file type. Strip any you find in files you touch. `npm run test:lint` enforces this.
2. Test first. Write the test, watch it fail for the right reason, then write the code. Say in the progress file how each test fails without its change.
3. One commit per task. The subject is `F2-03: add a query to a workbook` (task id, then an imperative summary). The body is two to four plain lines saying what changed and why.
4. Before every push run `npm run test:lint` and `npm run test:unit`. Both must be green.
5. Push only to your own branch. Never push to `fable`, `beta` or `main`, never force-push, never delete a branch.
6. CI runs on every push to `fable-*` branches and prints its result in check annotations; the run's log cannot be downloaded from outside GitHub. Do not regenerate baselines.
7. Never change an existing test's expectation, skip it, or delete it, unless a task card names that change. If an existing test fails because of your work, stop and ask the user.
8. Keep a progress file with, for each task: files changed, the test that fails without it, deviations, and decisions made inside gaps in the plan. Do not invent product behaviour; stop and ask the user when the plan is silent on something that changes what users see or what is written to a file.
9. Never touch an original workbook's bytes, never store base64 or binary data in code or storage, and never add a dependency.
10. When your last task is done and green, tell the user the final commit hash. Trunk merges.

## Decisions the user has to confirm before Scope starts

The plan stops at these. Opus's recommendations are shown; the user answers yes, or gives another answer.

- A3: the "has a header row" filter applies to Excel tables only, not to plain sheets. Recommendation: yes.
- A2: a query sees a sheet as the sheet's used range with columns named `Column1`, `Column2` and so on, and no header row guessed. Recommendation: yes.

Writer needs no decision before it starts. If F2-07 (module add and remove) finds that the VBA writer cannot change the module list, the plan says stop and ask the user whether to build it in this phase or defer it.

## Merge protocol

1. The agent reports its final commit hash to the user.
2. Trunk merges that branch into `fable` with a merge commit, resolves any conflict in favour of the file's owner above, adds the strings the agent listed, regenerates `asset-manifest.json`, and runs CI.
3. Trunk records the merge in `docs/fable/PROGRESS.md`.
