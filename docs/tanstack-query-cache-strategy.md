# TanStack Query cache strategy

TanStack Query owns the frontend cache for server reads. This rule also applies when the host runs Effect.

## Effect boundary

Effect owns typed failures, dependency wiring, I/O, lifecycle, and Promise conversion in the host. TanStack Query owns these frontend read concerns:

- Query keys and stale times.
- Cache lifetime.
- In-flight request deduplication.
- Cache updates and invalidation after a mutation.
- Loading and error state during render.

Put a reusable server read behind TanStack Query. Keep mutations, process lifecycle, runtime orchestration, event streams, and local UI actions outside it. Do not add a second cache for the same server data.

## Global defaults

`packages/frontend/src/lib/query-client.ts` sets:

- `retry: false`
- `refetchOnWindowFocus: false`
- `refetchOnReconnect: false`
- `staleTime: 60_000`
- `gcTime: 10 * 60_000`

These values stop hidden retries and surprise traffic after focus or reconnect. Each query group can replace the default stale time.

## Stale times

### Configuration

Invalidate these read-mostly values after a write.

| Data | Stale time |
|---|---:|
| Settings snapshot | 15 min |
| Repository config | 10 min |
| Workspace list | 5 min |
| Runtime definitions | 30 min |
| Runtime catalog | 5 min |

Query modules: `workspace.ts`, `runtime.ts`, and `runtime-catalog.ts` under `packages/frontend/src/state/queries`.

### Workflow data

| Data | Stale time |
|---|---:|
| Task list and runs | 30 sec |
| Runs | 30 sec |
| Agent session list | 30 sec |
| Task documents | 60 sec |
| Task approval context | 60 sec |
| Runtime instance list | 10 sec |

Query modules: `tasks.ts`, `agent-sessions.ts`, `documents.ts`, `task-approval.ts`, and `runtime.ts`.

### Checks and file data

| Data | Stale time |
|---|---:|
| Runtime check | 5 min |
| Task store check | 60 sec |
| Repository runtime health | 60 sec |
| Directory listing | 1 sec |
| Branches | 60 sec |
| Current branch | 60 sec |
| Worktree status | 0 |
| Worktree status summary | 0 |

Use a zero stale time for worktree status. TanStack Query still deduplicates concurrent reads, but the next caller does not trust an old diff snapshot.

Query modules: `checks.ts`, `filesystem.ts`, and `git.ts`.

## Read methods

Use `ensureQueryData` for configuration that can return a fresh cached value. Examples are `loadSettingsSnapshotFromQuery(...)` and `loadRepoConfigFromQuery(...)`.

Use `fetchQuery` for an imperative read that still needs the shared key and in-flight deduplication. Examples include task refresh, session history, documents, and worktree status.

Use `prefetchQuery` to warm the cache for a read that the user is likely to need next.

Task documents use a 60 second stale time for normal views. Workflow refreshes force a new fetch through `packages/frontend/src/state/queries/documents.ts` so an external ODT write appears without polling.

## Mutations

Do not depend on a background refetch for correct state.

- Call `invalidateQueries(...)` when the server changed and the client must read it again.
- Call `setQueryData(...)` when the mutation already returned the new source value.

For example, a settings save updates the settings cache. A repository settings save invalidates repository config. A task mutation invalidates task data and runs.

## Data that does not belong in Query

Keep these values outside TanStack Query:

- Live agent transcript assembly.
- Pending permission and question state.
- Composer input.
- Event-driven orchestration state.
- Commands such as `runtimeEnsure`, `buildStart`, `gitPushBranch`, and `taskTransition`.
