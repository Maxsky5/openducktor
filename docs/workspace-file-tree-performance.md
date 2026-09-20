# Workspace file-tree performance

Task: `openduckto-h099d`.

## Design

The file-tree service reads all visible paths from the Git index and working tree with one `git ls-files` command.

The command includes Git modes, so the adapter can report Git links as directories without a filesystem metadata call for each path.

The tree sets `size` and `mtimeMs` to `null` because the file explorer does not use these values.

The service still reads the workspace root metadata once to confirm that the root is a directory.

When the user opens a file, the host uses a literal Git pathspec to check only that path.

The host then reads one bounded snapshot that contains the bytes, file type, size, modification time, and revision.

If the path is a symbolic link, the host checks the canonical target with one more literal Git pathspec.

The frontend selects the clicked tree item before the file request completes.

It keeps the previous highlighted preview visible until the next file and its syntax highlight data are ready.

The preview then replaces the old file in one render and does not show a loading label during the switch.

## Measurements

The measurement ran on 2026-09-20 with Darwin 25.5.0 arm64, Bun 1.4.2, and Effect 3.22.2.

The fixture contains 10,000 tracked text files in 100 directories.

Each candidate ran in 20 fresh Bun processes.

Times include the command handler, Git commands, filesystem operations, sorting, and schema validation.

Times exclude process startup, module imports, the host router, Electron IPC, React rendering, and syntax highlighting.

The operating system cache was not cleared between processes.

| Operation | p50, ms | p95, ms | Filesystem `stat` calls | Snapshot reads |
| --- | ---: | ---: | ---: | ---: |
| First tree read | 77.7 | 86.2 | 1 | 0 |
| Second tree read | 70.7 | 77.1 | 1 | 0 |
| First selected-file read | 19.9 | 38.1 | 1 | 1 |
| Second selected-file read | 17.2 | 25.7 | 1 | 1 |

Each tree result contained 10,100 entries.

The prior bounded-concurrency implementation had a cold tree p50 of 189.2 ms and a warm tree p50 of 160.9 ms on the same fixture design.

The current implementation reduces those medians by about 59% and 56%.

It also reduces the tree metadata count from 10,001 `stat` calls to one root `stat` call.

## Reproduce

Create an isolated fixture:

```sh
python3 - <<'PY'
import pathlib
import subprocess
import tempfile

root = pathlib.Path(tempfile.mkdtemp(prefix="odt-file-tree-"))
for index in range(10000):
    file = root / f"dir-{index // 100:03}" / f"file-{index:05}.txt"
    file.parent.mkdir(exist_ok=True)
    file.write_text("benchmark file\n")
subprocess.run(["git", "init", "-q", str(root)], check=True)
subprocess.run(["git", "-C", str(root), "add", "."], check=True)
print(root)
PY
```

Run the checked-in probe and replace the fixture path with the printed path:

```sh
bun run packages/host/scripts/benchmark-workspace-file-tree.ts /tmp/odt-file-tree-EXAMPLE dir-000/file-00000.txt
```

The probe prints the first and second tree-read times, the first and second selected-file-read times, the entry count, the `stat` count, and the snapshot-read count.

## Regression checks

The host tests verify that a tree read does not inspect each file and that tree entries have nullable metadata.

The Git adapter tests verify regular files, untracked files, sparse paths, Git link directories, and literal selected-path queries.

The text-file tests verify selected-path queries, bounded reads, symbolic-link target checks, binary files, file-size limits, and revision-safe writes.

The frontend tests verify immediate tree selection and keep the previous highlighted preview visible until the selected file is ready.

```sh
bun test packages/host/src/adapters/git/git-cli-adapter.test.ts packages/host/src/application/filesystem/workspace-files-service.test.ts packages/host/src/application/filesystem/workspace-text-file-service.test.ts packages/frontend/src/components/features/agents/task-execution-file-preview.test.tsx packages/frontend/src/components/features/agents/task-execution-panel.test.tsx
```
