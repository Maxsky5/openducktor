# TanStack Query Cache Strategy

This document describes the cache and stale-time strategy used in `apps/desktop`.

## Global defaults

Defined in [apps/desktop/src/lib/query-client.ts](../apps/desktop/src/lib/query-client.ts):

- `retry: false`
- `refetchOnWindowFocus: false`
- `refetchOnReconnect: false`
- default `staleTime: 60_000`
- default `gcTime: 10 * 60_000`

These defaults match the desktop/browser-live host model:

- we do not want silent retries masking host failures
- we do not want focus or reconnect to trigger surprise backend traffic
- we want a short shared cache by default, then override by domain

## Strategy by data class

### Long-lived configuration

Used for shared, read-mostly configuration that changes rarely and should be invalidated explicitly after writes.

- settings snapshot: `15 min`
- repo config: `10 min`
- workspace list: `5 min`
- runtime definitions: `30 min`
- runtime catalog: `5 min`

Files:

- [apps/desktop/src/state/queries/workspace.ts](../apps/desktop/src/state/queries/workspace.ts)
- [apps/desktop/src/state/queries/runtime.ts](../apps/desktop/src/state/queries/runtime.ts)
- [apps/desktop/src/state/queries/runtime-catalog.ts](../apps/desktop/src/state/queries/runtime-catalog.ts)

### Medium-lived operational reads

Used for workflow data that can change during a session, but where we still want deduplication across repeated reads.

- task list plus runs bundle: `30 sec`
- runs only: `30 sec`
- agent session list: `30 sec`
- task documents: `60 sec`
- task approval context: `60 sec`
- runtime instance list: `10 sec`

Files:

- [apps/desktop/src/state/queries/tasks.ts](../apps/desktop/src/state/queries/tasks.ts)
- [apps/desktop/src/state/queries/agent-sessions.ts](../apps/desktop/src/state/queries/agent-sessions.ts)
- [apps/desktop/src/state/queries/documents.ts](../apps/desktop/src/state/queries/documents.ts)
- [apps/desktop/src/state/queries/task-approval.ts](../apps/desktop/src/state/queries/task-approval.ts)
- [apps/desktop/src/state/queries/runtime.ts](../apps/desktop/src/state/queries/runtime.ts)

### Diagnostics and health

Used for checks that are somewhat volatile, but still should not refetch constantly.

- runtime check: `5 min`
- beads check: `60 sec`
- repo runtime health: `60 sec`

File:

- [apps/desktop/src/state/queries/checks.ts](../apps/desktop/src/state/queries/checks.ts)

### Git state

Used for repository state where some values are stable and some are intentionally treated as immediately stale.

- branches: `60 sec`
- current branch: `60 sec`
- worktree status: `0`
- worktree status summary: `0`

`worktree status` is intentionally `0` because we want request deduplication and keyed caching, but we do not want the UI to trust an old diff snapshot once control returns to the caller.

File:

- [apps/desktop/src/state/queries/git.ts](../apps/desktop/src/state/queries/git.ts)

## Read patterns

We use two main imperative read patterns:

### `ensureQueryData`

Used for canonical configuration reads that should return fresh cached data if available, otherwise fetch.

Examples:

- `loadSettingsSnapshotFromQuery(...)`
- `loadRepoConfigFromQuery(...)`

### `fetchQuery`

Used for imperative operational reads where callers want the shared query behavior and in-flight deduplication, while still driving the read explicitly.

Examples:

- task/runs refreshes
- session hydration reads
- document reads
- worktree status reads

Task documents keep their normal `60 sec` stale time for ordinary viewing, but workflow-driven refreshes use explicit force-fresh fetches in `apps/desktop/src/state/queries/documents.ts` so external ODT document writes bypass stale adapter metadata without adding polling or focus refetching.

## Mutation strategy

We do not depend on background refetch heuristics for correctness.

Instead, mutations must do one of:

- `invalidateQueries(...)` when server truth changed and should be reloaded
- `setQueryData(...)` when the new canonical value is already known locally

Examples:

- saving settings snapshot updates the settings snapshot cache directly
- saving repo settings invalidates repo config
- task mutations invalidate repo task data and runs

## Non-goals

TanStack Query is not the source of truth for:

- streaming agent transcript assembly
- pending permission/question state
- composer input state
- event-driven orchestration state
- imperative mutation flows like `runtimeEnsure`, `buildStart`, `gitPushBranch`, or `taskTransition`

These remain outside Query on purpose.
