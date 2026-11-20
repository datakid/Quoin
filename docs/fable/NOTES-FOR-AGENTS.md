# Notes from trunk to the Writer and Scope agents

You are working in parallel with me on the `fable` branch. The user has told you to follow these notes. Read `docs/fable/PARALLEL.md` first (who owns which files) and this file second. If the two ever disagree, this file is newer.

## 1. Where trunk is

Done on `fable` and green on CI: F0-00 to F0-16 (workers, pool, set session, intake, shell, a single file opening from the set with every row of Fable section 6.1 proven by `tests/e2e/fable-parity.spec.js`), F1-01 recipe model, F1-02 resolve (Collect only), F1-03 collect execution in the worker, F1-04 Collect outputs and the "Export everything" run, F1-05 result table, F1-06 versions panel. Next on trunk: F1-07 (500-file scale test), F1-08 (Phase F1 gate), then integration as your branches arrive.

Before you start, and again after every task, merge `fable` into your own branch (`git merge fable`). That brings in:

- `docs/fable/00_FABLE.md` (the decision document; the plan's references to Fable sections now resolve; F3-02 uses its sections 3.2 and 3.3);
- CI on `fable-*` branches;
- the code you may read and reuse. Read-only imports from trunk-owned files are allowed (editing them is not): `zipClock` and `REPORT_COLUMNS` from `src/batch/execute/collect.js`, `sha256Text` and `sha256Bytes` from `src/batch/index/hash.js`, `parseRecipe` from `src/batch/recipe/recipe.js`, `indexWorkbook` from `src/batch/index/file-index.js`.

If a merge of `fable` conflicts in a file you own, keep your side and tell the user. If it conflicts in a file you do not own, take trunk's side and tell the user, because you should not have touched it.

## 2. The quality bar trunk applies before merging your branch

I will not merge a branch that fails any of these. Check them yourself first.

1. `npm run test:lint` prints `0 findings` and `npm run test:unit` has no failure, on your branch, after merging the latest `fable`.
2. CI on your branch is green for lint, unit and browser tests. Read it from the check annotations (see your brief) after each push. A red browser test on your branch means you changed something you must not have; stop and tell the user.
3. Every new test was seen to fail without the change it covers, for the right reason, and the progress file says how. Do the deliberate-break check too: after the code is green, break it on purpose (flip a condition, drop a guard, return early), see a test fail, then restore it. A test that cannot fail is not a test.
4. Tests prove behaviour, not implementation. Prefer real fixtures from `tests/fixtures/` over mocks; prove equality with today's single-file behaviour byte for byte where the plan says "exactly as today". Test the awkward cases: empty input, one item, many items, reversed input order, duplicate names, case differences, signed or locked macro projects, files with warnings.
5. Pure and deterministic. Same input and same frozen `now` give the same output, independent of input order and of the machine's time zone. Outputs are plain data that survives `structuredClone`. Inputs are never changed; tests assert that.
6. No comment of any kind in any file. No `console.log`. No new dependency. No `TODO`.
7. One task, one commit, subject `F2-03: add a query to a workbook`, body of two to four plain lines. No merge commits on your branch except merging `fable` into it.
8. The progress file is complete for every task: files, the failing-test evidence, deviations, decisions made in gaps, counts, and at the end the interfaces and the strings and codes you need from trunk.
9. Timing tests take the best of five runs and use a generous limit, because CI machines are slow and noisy. Never write a test that depends on wall-clock speed alone.

## 3. What went wrong on trunk, so you do not repeat it

- An existing test that depends on page order broke when I added an always-present hidden button to the top bar. Lesson: an existing test failing after your change is information. Never edit it to make it pass; find what you changed.
- Test T-E-11 fails if a string in the error table is used by nothing. You do not edit `strings.js`; list the strings you need and trunk adds them when it merges.
- UI text must come from `strings.js` (lint rule T-LINT-9). Anything that reaches a user from your code is a stable code such as `replace.noMatch`, never a sentence.
- Layer lint rules (T-LINT-18 to 20) caught me three times: `src/ui` cannot import `src/batch`, `src/batch/resolve` cannot import `execute` or `verify`, `src/batch` has no DOM or worker globals and no base64 helpers. The rule failing is right; restructure.
- A test that read the page before it had updated was flaky for months in beta. In unit tests the equivalent is asserting before an async step finishes; await everything, and never use `setTimeout` to wait.
- Zip bytes depend on the time stamped into each entry, and the DOS time is read in local time. Always pass the frozen `now` through `zipClock` and give `writeZip` `{now}`. Never call `new Date()` or `Date.now()` in a writer or resolver.
- Verify what you write by reading it back and comparing (see `readBack` in `src/batch/execute/collect.js`). If the check cannot pass, the output is not released; the verdict is `not-released` with a code.
- A recipe or plan must never be evaluated. Treat every string from a file or a recipe as data.

## 4. Writer: specific guidance

- Start with F2-01 and treat it as the foundation. `buildWorkbook` must keep producing exactly the bytes it produces today for every fixture; pin that with SHA-256 values computed from the base commit before you change anything. The generalised `selfCheck` must prove that everything not declared in the ChangeSet is byte-identical (compressed bytes and CRC) and keep reporting `write.selfcheck`.
- Every output must reopen with `openWorkbook` with no new warning and be savable again. Add that check to every writer test. This is what catches a metadata item you forgot to update when adding or removing a query.
- A query that is loaded to a sheet or has a connection is never removed or created by you (decision Q5). Say so in a test.
- Replace-in-code regex is the dangerous one: it must stop at a deadline you inject, between matches and between modules. Test with a pattern that would take far too long and assert `m.timeout`.
- F2-07 (module add and remove): answer the question first, with evidence, and tell the user before writing any module-list code.
- Report back to the user (so I can start integration early) after F2-02, after F2-05 and after F2-09. Each report gives the commit hash and the interface now available.

## 5. Scope: specific guidance

- Wait for the user's answers on A3 (before F3-01) and A2 (before F3-03); the user relays them. Use the plan's recommended answers only if the user says so.
- `resolvePlan` for Collect already exists and its 14 tests in `tests/unit/batch-resolve.test.js` must keep passing unchanged. Extend, do not replace. Keep `resolvePlan(recipe, indexes, {now})` as the only entry point.
- The file index you receive has `sheets[]` with `nonEmpty: null | true | false` and `tables[]`. When a rule depends on a `nonEmpty` that is still `null`, put `{fileId, need: 'nonEmpty'}` in `plan.needs` and leave that file unresolved; trunk runs the worker's `inspect` and calls `resolvePlan` again. A plan with an empty `needs` is final.
- Test ordering independence for everything: shuffled indexes and reversed indexes must give the identical plan. Test duplicate names with different case, hidden and very hidden sheets, tables with several header rows, and a pin for a file that is no longer in the set.
- The numbers in Fable section 9 (13 units across 10 files, groups of 7 and 3, skipped files with reasons) are your acceptance case for F3-01 and F3-02: build the 12 index objects for that example and assert every number.
- Report back to the user after F3-01 and after F3-04, with the commit hash and the interface now available.

## 6. How to ask for something

If you need a decision, a file outside your list, or an interface change in a trunk-owned file, write one short message to the user: what you need, why, what you recommend, and what you will do in the meantime on a task that does not depend on it. The user relays it to me. Do not guess on anything that changes what users see or what gets written to a file.

## 7. What happens when you finish

Tell the user your final commit hash. I merge your branch into `fable` with a merge commit, add the strings you listed, regenerate the asset manifest, wire your functions into the worker and the app (F2-10 onward for the Writer, F3-05 onward for Scope), run the full CI, and record the merge in `docs/fable/PROGRESS.md`. If anything fails after the merge I send the user a note for you with the exact failure.
