# Workspace file-tree metadata concurrency

Task: `openduckto-h099d`. Serial baseline: `5fa09d3dc0936ffc091b394e6a09adcb7e33de2b`.

The file-tree service runs at most four file metadata reads at once per request with `Effect.forEach`. It collects each typed result with `Effect.either`, then assembles entries in sorted path order. This keeps the same first error by path when several reads fail. It also keeps deleted-file handling, directory entries, and no-follow symlink metadata. A failed request can now inspect later paths before it returns the first error. It does not cache metadata.

## Measurements

Measured on 2026-09-08 with Darwin 25.5.0 arm64, Bun 1.3.10, and Effect 3.22.1. The repo requests Bun 1.3.14; that version was not installed for this run. The fixture has 10,000 real text files in 100 directories, staged in a local Git repository. Both Git and filesystem adapters use real I/O. Each successful tree request made 10,001 stat calls, including the root, and returned 10,100 entries.

Each candidate ran in 20 fresh Bun processes. Candidate order rotated each round. Each process measured its first tree read, then a second tree read with a text-file command in parallel. Times include the host command handler, Git reads, metadata reads, sorting, and response validation. They exclude process startup and module imports. p50 is the median; p95 is the 19th sorted sample of 20. All times are milliseconds.

"Cold" means the first tree read in a fresh process. "Warm" means the second read in that process. The OS filesystem cache was not flushed. These results do not measure physical-disk cold-cache latency or Electron IPC latency. Other work on this machine caused timing spikes, especially in the second run.

In the first run, the text-file command started at the root stat, before tree metadata reads began:

| Limit | Cold p50 / p95 | Warm p50 / p95 |
| --- | --- | --- |
| Serial baseline | 280.2 / 527.1 | 251.7 / 574.6 |
| 4 | 168.9 / 496.1 | 139.6 / 277.9 |
| 8 | 169.4 / 336.5 | 147.6 / 202.9 |
| 16 | 167.6 / 290.8 | 144.2 / 220.9 |
| 32 | 169.5 / 305.8 | 148.0 / 294.3 |

The second run started the text-file command at the first no-follow metadata read. This checks progress while the metadata work is active:

| Limit | Cold p50 / p95 | Warm p50 / p95 | Text-file command p50 / p95 |
| --- | --- | --- | --- |
| Serial baseline | 343.9 / 1542.6 | 330.1 / 897.7 | 39.9 / 84.3 |
| 4 | 213.9 / 1049.0 | 184.8 / 658.1 | 36.8 / 96.9 |
| 8 | 190.5 / 850.5 | 169.4 / 938.9 | 51.6 / 88.9 |
| 16 | 188.6 / 967.9 | 175.9 / 441.6 | 64.1 / 128.1 |
| 32 | 193.8 / 1008.6 | 163.3 / 745.8 | 87.1 / 178.9 |

Limit 4 gave the best warm median in the first run and the best text-file command median in the second run. Its warm tree median improved by about 44% in both runs. Higher limits can reduce tree time further, but they increased the competing command median in the second run. The p95 results vary too much to claim a stable tail-latency improvement. The limit applies to each tree request, not to all host requests combined.

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

The gate-controlled test starts four reads while 996 paths remain queued. Before the gate opens it checks four active reads and five total stat calls, including the root. It then checks peak concurrency four, 1,001 total stat calls, sorted paths, and correctly paired metadata. Other tests force out-of-order completion across files, directories, deleted files, and a broken symlink; check the first typed error by path; and interrupt active reads before queued paths start.

```sh
bun test packages/host/src/application/filesystem/workspace-files-service.test.ts
```

## Repository verification

`bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` passed. The final full test run passed without source changes after two earlier runs hit frontend onboarding timeouts. The 21 onboarding tests also passed in isolation. A separate base worktree passed its frontend tests, but its full run had a lint-plugin dependency setup failure, so that run does not establish a pre-existing repo failure. The new host concurrency tests passed in every run after implementation.
