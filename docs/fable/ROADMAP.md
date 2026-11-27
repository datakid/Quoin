# Roadmap: what is left, who does it, in what order

Written 2026-11-27 by the integrator. One owner per milestone. A milestone is blocked only by what its row says; everything else runs now. When a lane finishes its milestones it writes `HAND BACK <hash>` in its notes and the integrator gives it the next package from the end of this file or says there is none and why.

## Left to do, from the plan

| Plan item | State | Milestones that close it |
|---|---|---|
| F5-01 Firefox and WebKit | first CI run: Firefox 12 failures, WebKit 10 | H1 to H4, U1 to U4 |
| F3 gate (F3-11) | needs the sheet-write check and three decisions of the user | S1, then the user |
| F5-04 real Excel closure | the person has not yet run the packs in one sitting | W1, then the user |
| F5-05 README and decisions | partly done | S5, W5, I2 |
| F5-06 final gate | not started | I4 |
| Not in the plan, found on the way | sheet names cut by code points, undeclared parts in sheet writes, hostile-input behaviour of the readers, writer behaviour over random sequences | S1, S3, W2, W3 |

## Lanes and milestones

| Owner | Milestone | Deliverable | Needs |
|---|---|---|---|
| scope | S1 | sheet-write trust gate: declared insertions, `<numFmts>` fix, UTF-16 sheet names, nine probes as tests | nothing |
| scope | S2 | Transform outputs over the whole fixture corpus, three modes | nothing |
| scope | S3 | resolve properties, 500 seeded recipes | nothing |
| scope | S4 | 300 workbooks, 1,200 units, stop in the middle | nothing |
| scope | S5 | decisions text, strings table, requests to other owners | S1 to S4 |
| writer | W1 | Excel sitting kit: one zip, one checklist, `RESULTS.csv`, a reader that drafts the observations text | nothing |
| writer | W2 | writer sequences, randomized, 300 cases | nothing |
| writer | W3 | hostile inputs for the compound-file and query readers | nothing |
| writer | W4 | review of Scope's S1 against the nine probes | S1 on `fable` |
| writer | W5 | table of checks and tests, requests to other owners | W1 to W4 |
| harness | H1 to H4 | the six test-side and engine-limit failures, CI summary, flake audit, skip helper | nothing |
| ui | U1 to U4 | WebKit virtualisation, row-diff on phones, Firefox drag and Tab, copy, 1,000,000-row scroll; phone audit; forced colours; keyboard | nothing |
| integrator | I1 | strings for Scope's codes, D2 (hide `unchanged` rows with a count), closing run message | Scope's tree (merged) |
| integrator | I2 | README features, entry paths, storage keys and limits; `docs/decisions.md` | S5, W5, lane notes |
| integrator | I3 | CI loop: push, read the `browsers` run, send each failure to its owner | lanes pushing |
| integrator | I4 | final gate: section 9 and 10 checklist with evidence, checked by an agent that did not write the code | everything above |

## Waiting on the user, not on any agent

1. The three differences under F3-10 and the 15-line report (section 9 decision 2).
2. The Excel sitting with the kit from W1.
3. Whether to build a recipe editor (there is none today; recipes are authored by hand or by the screens). Nothing is started on it.
4. F3-08 (in place) and F3-09 (Excel computes on open): held until X03 and the other Excel results exist.

## Next packages, ready when a lane finishes

- scope: output formats for the combined workbook (freeze panes, widths, header style) with tests, only if the user wants them; otherwise help harness on the Safari offline question by reading how the service worker caches.
- writer: password-protected macro project fixture and its refusal path; signature removal corner cases.
- harness and ui: the visual baselines for each new surface in Firefox and WebKit, once the first browsers run is green.
