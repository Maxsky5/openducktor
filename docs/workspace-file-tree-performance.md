# Workspace file-tree metadata concurrency

Task: `openduckto-h099d`. Serial baseline: `5fa09d3dc0936ffc091b394e6a09adcb7e33de2b`.

The file-tree service runs at most four file metadata reads at once per request with `Effect.forEach`. A scoped producer puts each result into a `Deferred`. The consumer reads these results in sorted path order and assembles entries. It returns the first non-deleted error as soon as earlier paths have resolved. Closing the scope interrupts later in-flight Effects and stops queued work. Deleted-file handling, directory entries, and no-follow symlink metadata stay unchanged. Results exist only for the current request; there is no persistent cache.

## QA correction

The first implementation collected all metadata before checking errors. QA showed that an error for `a` could wait forever for a stalled read of `b`. The ordered consumer removes that barrier while retaining first-path error selection. Two gate-controlled regressions failed before the correction and now pass: an immediate error with later blocked work, and an error after a later read starts. A third test holds an earlier path open, skips a deleted-file failure, then verifies that the next non-deleted error returns without waiting for a final stalled read.

## Measurements

Refreshed after the QA correction on 2026-09-08 with Darwin 25.5.0 arm64, Bun 1.3.10, and Effect 3.22.1. The repo requests Bun 1.3.14; that version was not installed for this run. The fixture has 10,000 real text files in 100 directories, staged in a local Git repository. Both Git and filesystem adapters use real I/O. Each successful tree request made 10,001 stat calls, including the root, and returned 10,100 entries.

Each candidate ran in 20 fresh Bun processes. Candidate order rotated each round. Each process measured its first tree read, then a second tree read with a text-file command that starts at the first no-follow metadata read. It then measured the same text-file command with no tree request active. Times include the command handler, Git reads, metadata reads, sorting, and response validation. They exclude process startup, module imports, the host router, and Electron IPC. p50 is the median; p95 is the 19th sorted sample of 20. All times are milliseconds.

"Cold" means the first tree read in a fresh process. "Warm" means the second read in that process. The OS filesystem cache was not flushed. These results do not measure physical-disk cold-cache latency or full transport responsiveness. Other work on this machine can affect timing, so the results do not establish a stable p95 improvement.

| Limit | Cold p50 / p95 | Warm p50 / p95 | Competing text-file command p50 / p95 | Idle text-file command p50 / p95 |
| --- | --- | --- | --- | --- |
| Serial baseline | 298.8 / 483.3 | 270.7 / 388.0 | 29.8 / 37.1 | 27.8 / 34.3 |
| 4 | 217.2 / 302.7 | 189.2 / 337.0 | 40.3 / 50.3 | 26.7 / 51.0 |
| 8 | 206.0 / 277.4 | 182.1 / 240.2 | 52.7 / 102.1 | 28.0 / 36.6 |
| 16 | 203.4 / 283.5 | 169.8 / 277.8 | 90.0 / 104.1 | 24.1 / 37.8 |
| 32 | 203.0 / 430.9 | 171.0 / 394.0 | 101.5 / 138.0 | 25.7 / 37.9 |

Limit 4 reduces the warm tree median by about 30% and gives the lowest competing-command median among the concurrent limits. Higher limits reduce tree time further but delay the competing request. At limit 4 the competing command median is 40.3 ms, versus 26.7 ms with no tree request active. The limit applies to each tree request, not to all host requests combined. These measurements replace the first implementation's measurements because the scheduling code changed.

## Reproduce

Create an isolated fixture with this script. It writes only under a new temporary directory and prints that path:

```sh
python3 - <<'PY'
import pathlib
import subprocess
import tempfile
root = pathlib.Path(tempfile.mkdtemp(prefix='odt-file-tree-'))
for index in range(10000):
    file = root / f'dir-{index // 100:03}' / f'file-{index:05}.txt'
    file.parent.mkdir(exist_ok=True)
    file.write_text('benchmark file\n')
subprocess.run(['git', 'init', '-q', str(root)], check=True)
subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
print(root)
PY
```

Run the checked-in probe in a fresh process for each sample. Replace the fixture path with the printed path:

```sh
bun run packages/host/scripts/benchmark-workspace-file-tree.ts /tmp/odt-file-tree-EXAMPLE dir-000/file-00000.txt
```

The probe prints JSON with first-read and second-read duration, stat count, peak concurrency, entry count, competing text-file command duration, and a separate idle text-file command duration. For the candidate comparison, temporary service copies used limits 4, 8, 16, and 32; a copy from the task base supplied the serial baseline. The temporary copies used the same imports and code except for the concurrency limit. No production configuration or test option was added.

## Regression checks

The gate-controlled test starts four reads while 996 paths remain queued. Before the gate opens it checks four active reads and five total stat calls, including the root. It then checks peak concurrency four, 1,001 total stat calls, sorted paths, and correctly paired metadata. Other tests force out-of-order completion across files, directories, deleted files, and a broken symlink; check first-path error selection; and interrupt active reads before queued paths start. The QA regressions check that later blocked reads cannot delay a known error and that the service interrupts its owned work without opening the blocked gate.

```sh
bun test packages/host/src/application/filesystem/workspace-files-service.test.ts packages/host/src/interface/commands/workspace-files-command-handlers.test.ts
```

## Repository verification

The focused run passes 37 tests with 1,074 assertions. After this correction, all five full repository commands passed: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build`. The full test suite passed on its first run for this correction. The build ran before the test suite.
