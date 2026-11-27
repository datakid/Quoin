# Quoin — fable merge patch pack

What this is: the **one blocker** that stops `fable-writer` + `fable-scope`
merging into `fable` without a regression, fixed in code, plus the regression
test that keeps it closed, plus the work split for the four agents.

Every line is derived from the actual sources I read on GitHub:

- `fable` @ `79d4a63`
- `fable-writer` @ `c256320`
- `fable-scope` @ `53ced44`

**What I could not do:** this environment has no shell, no Node, no git and no
archiver. I could not run `npm test`, could not perform the merge, and could not
produce a `.zip`. Everything below is written so your agents only have to copy
one file and run one command — but they still have to run it.

---

## Contents

| Path | Goes to | Kind |
|---|---|---|
| `src/core/save.js` | `src/core/save.js` | Scope's file with Writer's Finding 5 fix applied. This is the single merge conflict. |
| `tests/unit/sheet-no-numfmts.test.js` | `tests/unit/` | New. Regression cover for Finding 5, through `applyChangeSet`. |
| `AGENT-PLAN.md` | read, not copied | The work split: integrator, Writer, Scope, and the reviewer lane that was missing. |

---

## The bug, exactly

`fable-scope@53ced44`, `src/core/save.js`:

```js
function removable(text, fragments, original) {
  if (!fragments.length) return text === original;
  ...
}

function onlyInsertions(original, output, { fragments, countElements }) {
  return removable(withoutCounts(output, countElements), fragments, withoutCounts(original, countElements));
}
```

`count="…"` is stripped from **both** texts *before* the declared insertion
fragments are searched for.

When a workbook's `styles.xml` has no `<numFmts>` element, the sheet writer must
create the whole element, so the fragment it declares is:

```
<numFmts count="2"><numFmt numFmtId="164" .../><numFmt numFmtId="165" .../></numFmts>
```

`withoutCounts` rewrites that in the output to `<numFmts>` — so the fragment can
never be found, `removable` returns `false`, and `selfCheck` throws:

```
write.selfcheck: check.part xl/styles.xml
```

This fires for **every XlsxWriter workbook** and **every Excel workbook that only
uses General number formats** — i.e. adding a result sheet to them fails
outright. That is pack 2, case **T05 (`xw_macro04.xlsm`)**, and it is the reason
`excel-pack.test.js` and `excel-pack-claims.test.js` are red on the merged tree.
Writer wrote the diagnosis and the fix in `MESSAGES-writer.md` finding 5 and
tested it on a scratch merge; Scope owns the file, so it never landed.

---

## The fix

Strip the fragments from the **raw** text, and normalise `count` only at the
terminal comparison, where both sides are about to be compared as wholes.

```js
function removable(text, fragments, original, counts) {
  if (!fragments.length) return counts(text) === counts(original);
  const [first, ...rest] = fragments;
  for (let at = text.indexOf(first); at !== -1; at = text.indexOf(first, at + 1)) {
    if (removable(text.slice(0, at) + text.slice(at + first.length), rest, original, counts)) return true;
  }
  return false;
}

function onlyInsertions(original, output, { fragments, countElements }) {
  return removable(output, fragments, original, (t) => withoutCounts(t, countElements));
}
```

That is the complete behavioural change. Two consequences, both intended:

1. **The gap stays closed.** A fragment that is not in the declared set still
   cannot be removed, so all nine tamper probes in
   `docs/fable/excel-pack/repro-sheet-gap.mjs` still reject — including
   "change only the `count` of the cell formats", because `count` on the
   *original* elements is still compared.
2. **The false refusal goes.** A whole created `<numFmts count="2">…</numFmts>`
   element is now findable in the raw output, so it can be removed, so the
   check passes.

It is a refusal-safe change: it can only turn a false refusal into an accept,
never an accept into a silent gap.

---

## The merge, in order

```bash
git fetch origin
git checkout fable && git pull

git merge origin/fable-writer     # expected: clean
git merge origin/fable-scope      # expected: conflict in src/core/save.js ONLY

cp <pack>/src/core/save.js        src/core/save.js
cp <pack>/tests/unit/sheet-no-numfmts.test.js tests/unit/

npm run build                     # regenerates asset-manifest.json -> clears T-PRIV-1
node tests/lint/run.js            # must be 0 findings (also catches conflict markers, T-LINT-22)
npm test
node docs/fable/excel-pack/repro-sheet-gap.mjs   # must print "every tampered output was rejected"
```

`asset-manifest.json` on `fable-scope` is missing `src/batch/execute/excel-compute.js`,
`src/core/sheet/styles.js` and `src/core/sheet/write-ranges.js`; `npm run build`
on the merge is what fixes `T-PRIV-1`. Do not hand-edit the manifest.

---

## Two more things the merge will surface — both already checked

**1. `src/app/outputs.js` does NOT need patching.** Writer's trunk bug #6 said
`index.xlsx` was built without the frozen clock. On `fable@79d4a63` it is
already fixed — both `tablesToXlsx(...)` and `zipFiles(...)` receive
`{ now: zipClock(now) }` at lines 137 and 140. Leave that file alone.

**2. `tests/unit/sheet-add.test.js` will conflict, and Writer's side is stale.**
Writer's copy still asserts:

```js
test('sheet writes into existing sheets are still not applied', async () => {
  ...
  await assert.rejects(() => applyChangeSet(wb, cs, { now: NOW }), /not applied/);
});
```

That expectation predates Scope's F3-06 `writeRangesToPackage` +
`verifyWrittenRanges`. Take **Scope's** side of that file (it has no such test
and adds the anchor-based write tests instead). If the merge leaves the stale
test in, replace it with this:

```js
test('sheet writes into existing sheets are applied and verified', async () => {
  const cs = emptyChangeSet();
  cs.sheets.write.push({ sheet: 'Input', anchor: { row: 0, col: 4 }, table: tableOf(SMALL), culture: 'en-US' });
  const wb = await open('pq_simple.xlsx');
  const out = await applyChangeSet(wb, cs, { now: NOW });
  const back = await openWorkbook(out.bytes, 'written.xlsx');
  const grid = await readUsedGrid(back, 'Input');
  assert.deepEqual(grid.slice(0, 3).map((r) => r.slice(4, 6)), expectedGrid(tableOf(SMALL), 'en-US'));
});
```

`src/batch/execute/index.js` is **not** in this pack on purpose. The conflict
there is expected and trivial — `fable` has `withoutTexts`/`includeTexts`,
`fable-scope` adds `allowInPlace` and `withInjectTokens` — and both sides are
meant to be kept. Resolve it in the editor; there is no reason to swap the file
wholesale and risk dropping Scope's token pass or Writer's `shouldStop`.

---

## What is genuinely left, and it is not code

`MANAGER.md` §5 gates each output mode behind a human opening a real workbook.
The record as it stands: pack 1 was opened once, informally — no repair message,
queries and macros ran, **contents not reviewed, checklist not ticked**. That
released new file, new sheet and combined.

Still held, and no agent can code past them:

- **F3-08 in place** — no case exists in pack 1 or pack 2. Pack 2's X03 needs an
  input workbook with a formula, a pivot table, data validation and a chart near
  the target range.
- **F3-09 Excel computes on open** — needs a human to confirm the refreshed
  table equals the table Quoin computes from the same recipe.

Both stay unreachable until that happens. Do not describe a wired-and-previewable
mode as released.

---

## How to verify this pack without Excel

`docs/fable/excel-pack/repro-sheet-gap.mjs` is the standing proof, and it needs
no Excel. After the merge it must print:

```
every tampered output was rejected: the gap is closed
```

and exit 0. If it prints any `ACCEPTED by selfCheck (gap)`, the merge took a
side that is not this file. Scope's request 3 is to update that script to pass
`texts` and `insertions` — it imports `addSheetsToPackage` directly today, so
whoever touches it should switch to the `applyChangeSet` path if they want it to
exercise the real seam.
