# Untracked diff command performance

Task `openduckto-lpo3k` reduces each untracked file from two Git commands to one and limits concurrent file commands to four.

## Command and result contract

The loader runs `git diff --no-index --numstat -z --patch -- /dev/null <file>` once per distinct file after directory expansion. It reads the counts and exact path from the NUL-delimited numstat record, then reads the patch after the NUL separator. It does not parse filenames from quoted patch headers. Directory expansion uses `git ls-files --others --exclude-standard -z`.

[Git documents](https://git-scm.com/docs/git-diff) patch/stat combinations, NUL-delimited numstat records, and the difference exit status of 1. The fixtures in `packages/host/src/infrastructure/git/fixtures/no-index-diffs.json` record combined output, separate numstat output, and separate patches from Git 2.50.1. Each fixture includes its source content. Tests compare the full `FileDiff` values and run the fixtures with real Git. Filesystem tests omit names that Windows cannot create; parser tests cover every name on all platforms.

The runner exposes numeric exit status for both command paths. The loader accepts exit 0 or difference exit 1, requires a matching numstat record and patch, and rejects other exit statuses even when stdout contains a patch. Empty and binary files retain zero counts and their Git patches. Results retain their prior line ending normalization, final blank line, and filename sort order.

## Benchmark method

Run from the repository root:

```sh
bun run packages/host/scripts/benchmark-untracked-diffs.ts
```

The optional first argument selects the baseline commit. The default is `5fa09d3dc0936ffc091b394e6a09adcb7e33de2b`. The script loads the original diff builder and runner from that commit, creates temporary files, warms both implementations once for each file count, and records seven pairs of runs with alternating order. It removes temporary sources and data in `finally`. It asserts full result equality for every pair and reports command counts, peak concurrency, and wall time as JSON.

The generated set contains 80 text files of 100 lines each, 10 binary files, and 10 empty files at the 100-file size. File generation occurs outside the measured interval. The measured interval covers the production `buildFileDiffs` call with the real Git runner, including file stat calls. It excludes tracked diffs and Git status reads. Directory expansion has separate correctness and command-count tests.

## Local results

Measured on macOS with Bun 1.3.10 and Git 2.50.1, Apple Git-155. The repo requests Bun 1.3.14; this environment supplied 1.3.10.

| Files | Commands before / after | Peak before / after | Median before, ms | Median after, ms | Before range, ms | After range, ms |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 / 0 | 0 / 0 | 0.02 | 0.06 | 0.01–0.12 | 0.04–0.16 |
| 1 | 2 / 1 | 1 / 1 | 25.39 | 13.34 | 24.40–26.79 | 12.66–15.44 |
| 100 | 200 / 100 | 1 / 4 | 2086.22 | 312.22 | 1916.21–3545.73 | 265.72–1775.75 |

Full result values matched in all 21 measured pairs. The 100-file median decreased by 85%. The wide timing ranges show host scheduling noise. These results do not predict latency on other systems or for large files.

## Scope adjustments

No saved spec or implementation plan existed when the build started. The task description supplied the scope. Exit status propagation was necessary because the original runner exposed only `ok`, which could not distinguish a difference from a command failure. Exact filename parsing also fixes prior failures for quoted names, whitespace, and literal rename notation within untracked filenames. The tracked diff parser remains outside this change.
