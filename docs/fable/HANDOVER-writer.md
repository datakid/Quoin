# Writer hand-over

Date: 2026-11-25. From: Writer agent (branch `fable-writer`). To: whoever the manager assigns next.

## Where the branch is

- Last green commit: `bf3edfb` (merge of `fable` into `fable-writer`). Lint 0 findings; unit 1729 of 1734 pass, 5 skipped; CI green including the Browser step.
- Everything in `docs/fable/PROGRESS-writer.md` up to F2-15 is committed and pushed.
- Uncommitted work: see "Unfinished" below. It is saved as `docs/fable/handover/writer-connection-wip.patch` (not on the branch as a commit). Apply with `git apply docs/fable/handover/writer-connection-wip.patch` only after reading it.

## Unfinished: connection for an added query (Pack 3 case 02 question)

Question from the user's static check: added queries exist only in the mashup, with no `<connection>` in `xl/connections.xml`. The Queries & Connections pane may not show them. Writer's answer is an opt-in: `ChangeSet.queries.connect` (a Set of added names) makes `applyChangeSet` write the connection-only element Excel writes. The element is byte-equal to Excel's own in a real fixture (test in `batch-pq-members.test.js`).

State of the patch:
- 47 of 48 tests in `tests/unit/batch-pq-members.test.js` pass.
- The failing one: "a name with characters that XML must escape is escaped in the connection and read back". Cause not yet found; the escaping is in `connectionFragment` (`src/core/pq/members.js`) and the expectation for the `Location=` text may be wrong, so check the test before the code.
- Mutation checks: all except "name not escaped" and "connection string not escaped" are caught. Those two survive because no test uses a name with `&`, `<` or quotes inside the connection string; the failing test above is meant to catch exactly that.
- Not done: `executeFile` does not set `queries.connect` yet (no recipe field); no Excel check of the new element. Keep it opt-in until the real-Excel pack says yes.

## Decisions and rules that still hold

- No code comments in any file. Tests first. One commit per task. Lint and unit before every push.
- Do not edit `src/batch/resolve/**`, `strings.js`, `main.js`, the worker, the manifest or visual baselines. Scope owns the sheet seam in `save.js`; ask in `MESSAGES-writer.md` first.
- Open finding 5 (Scope's `save.js`): the insertions check refuses a sheet add when `styles.xml` has no `<numFmts>`. Patch is in `MESSAGES-writer.md`; Scope has not applied it.
- Real-Excel checks are not done by anyone. Pack 3 (`--only=writer-added`) has a static pass by the user; Excel is still needed for: open without repair, refresh showing Version, the editor preview and Refresh All for case 02, Alt+F8 runs and Save As for 03/04, Digital Signature state for 04/07.

## Next steps, in order

1. Fix the failing escaping test (check the expectation first), then make the two surviving mutations die.
2. Decide with the manager whether `connect` ships opt-in or becomes the default for added queries. Do not make it default without the real-Excel result for case 02.
3. Wire `connect` into the recipe model only if the manager assigns it (it touches `src/batch/recipe/**`, which is not Writer's file list).
