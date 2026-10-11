# Session refresh measurement for openduckto-7cdn

## Purpose

This report compares task-change session refresh traffic before and after the batched session-list reads.

It covers one affected task and 100 affected tasks.

## Revisions

| Version | Commit |
| --- | --- |
| Before | `88a965d1bf8125c99c0c2f186c3a81449ae6ef24`, the merge base with `origin/main` |
| After | This branch. The measured commit `a5c5c345d` has the same code before the squash and rebase. |

The before version refreshes each affected task with its own `agentSessionsList` request.

The after version reads the affected tasks of a workspace through one `agentSessionsListForTasks` request.

## Method

Run the measurement from `packages/frontend`:

```sh
SESSION_REFRESH_BASELINE=88a965d1bf8125c99c0c2f186c3a81449ae6ef24 bun test ../../scripts/measure-session-refresh.ts
```

The script [measure-session-refresh.ts](../../scripts/measure-session-refresh.ts) copies the baseline `agent-sessions.ts` and `agent-session-view-sync.ts` from Git and removes the copies after the run.

The workload uses these conditions:

- A temporary host SQLite task store contains 100 tasks.
- Every fifth task has no session. The other tasks have one or two sessions with a selected model.
- Each affected task has a mounted list view with a loaded empty list.
- One `tasks_updated` event names all affected tasks.
- Fixture HTTP endpoints serve the session-list commands and the live refresh over loopback.
- Each endpoint waits 25 ms before it responds.
- The session-list endpoints read their records from the host SQLite task store.
- A TCP proxy counts every transferred request and response byte, including HTTP headers and framing.
- The live refresh endpoint returns a `null` body. It does not include runtime or SSE traffic.
- Completion time starts when the session view synchronizer receives the event. It ends after the required live refresh completes.
- Each case runs 7 trials. The tables show the median trial.

After each trial, the script compares each affected list with the host SQLite records. The comparison includes all fields, record order, and empty lists.

## Results

These values are fixture measurements on one development machine. They are not production traffic measurements.

### One affected task

| Value | Before | After |
| --- | ---: | ---: |
| Session-list requests | 1 | 1 |
| Live refresh requests | 1 | 1 |
| Transferred request bytes | 347 | 349 |
| Transferred response bytes | 597 | 644 |
| Completion time | 57.43 ms | 58.42 ms |

### 100 affected tasks

| Value | Before | After |
| --- | ---: | ---: |
| Session-list requests | 100 | 1 |
| Live refresh requests | 1 | 1 |
| Transferred request bytes | 18,959 | 2,133 |
| Transferred response bytes | 49,854 | 39,053 |
| Completion time | 125.90 ms | 73.41 ms |

### Correctness

All 1,414 list comparisons matched the host SQLite records in both versions and both sizes.

The request and byte counts were the same in all 7 trials of each case.

## Environment

The run used Bun 1.4.2 on Linux x64 on 2026-10-11.

Other work ran on the machine at the same time, with a load average near 7. Completion times can change on another machine or under another load. The request and byte counts do not depend on load.

## Limits

The fixture uses loopback with a fixed 25 ms delay for each request.

It does not measure network latency, Electron IPC, or browser runner transport overhead.
