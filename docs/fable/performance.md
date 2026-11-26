# Performance

Measured with `tests/e2e/fable-perf.spec.js`. It is skipped unless `QUOIN_PERF=1` is set, so it never slows the normal run. It drops a generated folder of copies of `mixed.xlsm` (51 KB each, 20 subfolders), waits for indexing, types into the filter, then Previews and Gets an Inject that adds a query to every file. Main-thread stalls come from a `longtask` observer. Memory is the main thread's JS heap plus array-buffer backing store after a forced GC (`Runtime.getHeapUsage`).

## Where it was measured

| | Build sandbox |
| --- | --- |
| CPU | Intel Xeon 2.3 GHz, 2 cores |
| Browser | Chromium 153 |
| `navigator.hardwareConcurrency` | 2 |
| Worker pool | 1 worker (`min(4, cores - 1)`) |
| In-flight budget | 768 MiB |

This is a small machine with a single worker, so the throughput numbers are the pessimistic case. A laptop with four or more cores gets up to four workers.

## Results

Index time, Preview and Get are for the whole set, from the click or drop to the screen showing the result.

| Files | Index | Preview | Get (zip) | Longest main-thread stall | Heap after |
| --- | --- | --- | --- | --- | --- |
| 500 | 2.7 s (183 files/s) | 6.4 s (78 files/s) | 6.7 s (75 files/s), 7.6 MiB zip | 101 ms (Preview) | 5 to 6 MiB |
| 2,000 | 17.3 s (116 files/s) | 20.9 s (96 files/s) | 24.4 s (82 files/s), 30.4 MiB zip | 484 ms (Preview) | 8 to 11 MiB |

Typing in the filter over 2,000 files: longest stall 108 ms.

### Against the targets (plan Q6)

| Target | Result |
| --- | --- |
| Index 500 files in under 60 s with the UI responsive | 2.7 s. The longest stall was under the 150 ms the scale test allows. |
| Inject at least one small file per second per worker | 75 to 96 files per second with one worker. |
| Largest responsive folder at least 2,000 files | 2,000 files indexed, filtered, previewed and downloaded. Preview stalls the page for 484 ms at that size, over the 150 ms the scale test allows for indexing, so "responsive" holds for indexing and filtering and not entirely for Preview. Nothing above 2,000 files was tried. |
| Memory ceiling | See below. |

## What measuring found

1. **Indexing was quadratic.** The first run took 14.0 s for 500 files and 195.7 s for 2,000 (36 and 10 files per second). The Files list was rebuilt in full after every file finished, so 2,000 files meant 2,000 rebuilds of 2,000 rows. The shell now redraws progress at most five times a second and still redraws at once for a state change or an action by the person. Indexing 500 files went from 14.0 s to 2.7 s and 2,000 files from 195.7 s to 17.3 s. `fable-scale.spec.js` now counts how many times the list was rebuilt while 500 files indexed and fails if it is more than one per 150 ms.
2. **The pool was charged the size of the file on disk, not the inflated size.** Q4 says the budget counts inflated bytes. A 5 MB workbook may inflate to 1 GiB within the size limits, so four of them in flight could hold about 4 GiB while the pool believed it held 20 MB. The index now records the inflated size the zip declares, and every job is charged `max(file size, inflated size)`. The fixtures inflate to about their own size (mixed.xlsm is 51,564 bytes and inflates to 59,617), so nothing in the suite comes near the budget; the check is a unit test that every job is charged at the declared size.
3. **Preview stalls the page for about a quarter of a millisecond per file** (101 ms at 500 files, 484 ms at 2,000). It is linear, not the quadratic problem above. The cause has not been found. At 5,000 files it would be over a second.

## Memory

- `fable-memory.spec.js` runs five Previews and Gets of 50 files in one page. After a warm-up run the main-thread heap (JS heap plus array-buffer backing) stays within 10% of its baseline for the next four, the pool reports nothing in flight, nothing running and nothing queued, and every worker is idle. A second test shows that a Preview alone holds no output bytes. Retaining each downloaded zip made the first test fail.
- The first run adds about a quarter to the heap because the batch modules are loaded and compiled by then, so the baseline is taken after one warm-up run and not before the first. The plan asked for a baseline before the first run.
- The heap counts the main thread only. Playwright cannot read a dedicated worker's heap, so the test checks the pool's accounting and the code (workers keep no workbook between jobs, and the old single-file result store is not used by batch jobs).
- Main-thread memory for 2,000 files is 8 to 11 MiB.

## Not measured

- Peak memory of the whole browser with large workbooks. The fixtures are small, so the 768 MiB budget (384 MiB when `navigator.deviceMemory` is 4 or less) has never been reached.
- The zip ceiling (1 GiB). The largest zip made was 30.4 MiB.
- Folders above 2,000 files.
- Firefox and WebKit speed.
- Machines with more than two cores. The `perf` workflow in CI can be run by hand (`workflow_dispatch`) to measure on a four-core runner.

## Q4 and Q6 numbers

No number in the plan has been changed. Q4's definition now matches the code (see 2 above). The Q6 targets are met on this machine, with the Preview stall noted.
