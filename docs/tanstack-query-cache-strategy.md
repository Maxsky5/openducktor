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
| Runtime catalog | 30 min |

Query modules: `workspace.ts`, `runtime.ts`, and `runtime-catalog.ts` under `packages/frontend/src/state/queries`.
The runtime catalog keeps inactive results for 60 minutes so a modal can show cached models during a later refresh.

### Workflow data

| Data | Stale time |
|---|---:|
| Task list and runs | 30 sec |
| Runs | 30 sec |
| Agent session list | 30 sec |
| Task documents | 60 sec |
| Task approval context | 60 sec |
| Host runtime and MCP bridge status | Infinite, updated by events |

Query modules: `tasks.ts`, `agent-sessions.ts`, `documents.ts`, `task-approval.ts`, `runtime.ts`, and `host-runtime-status.ts`.

The `openducktor://runtime-changed` event stream owns host runtime status and MCP bridge status after the first read. Merge each event into the cached snapshot by host instance and revision. Do not poll it.

Session records include the saved `lastActivityAt`. A `task_session_records_updated` event replaces the task's cached session list after commit. Cancel older reads and advance the list's invalidation version so a response in flight cannot replace the event with stale data. Workspace session updates use their existing record event. These updates do not trigger another read.

A task event for an inactive workspace invalidates its task list and session lists. Only lists that a view observes read again at once, such as the session list in all-workspaces scope. A stream snapshot keeps and reads again the observed session lists of inactive workspaces, and removes the others.

### Checks and file data

| Data | Stale time |
|---|---:|
| PATH check | 5 min |
| Git check | 5 min |
| Task store check | 60 sec |
| Directory listing | 1 sec |
| Branches | 60 sec |
| Current branch | 60 sec |
| Worktree status | 0 |
| Worktree status summary | 0 |

Use a zero stale time for general worktree status reads. Session Git panels reuse completed comparison and status reads for the same repository, directory, branch, target, and scope. Session activation does not refresh these reads. Manual refresh, file events, Git actions, and focus refresh check Git and update or invalidate the cache. Cancel unfinished status reads when their view ends, and keep view guards separate from cache keys so late reads cannot enter a new view. An unknown branch shows a pending or unavailable label; only a completed read can show a detached branch.

Query modules: `checks.ts`, `filesystem.ts`, and `git.ts`.

## Read methods

Use `ensureQueryData` for configuration that can return a fresh cached value. Examples are `loadSettingsSnapshotFromQuery(...)` and `loadRepoConfigFromQuery(...)`.

Use `fetchQuery` for an imperative read that still needs the shared key and in-flight deduplication. Examples include task refresh, session history, documents, and worktree status.

Use `prefetchQuery` to warm the cache for a read that the user is likely to need next.

Task documents use a 60 second stale time for normal views. Workflow refreshes force a new fetch through `packages/frontend/src/state/queries/documents.ts` so an external ODT write appears without polling.

## Disabled reads

One query key must map to one query function. TanStack Query keeps one options object per query, and the last observer that sets options wins.

- A conditional read keeps its real key and query function. It turns off with `enabled: false` and keeps cached data.
- A read with no target uses `skippedQueryOptions`. Its key must not equal a live key. Use the reserved `skipped` key segment in the module that owns the live keys.
- A skipped read that shares its key with a live read breaks `invalidateQueries` and `refetch`: the next refetch runs the skipped query function and fails with `Missing queryFn`.

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
- Commands such as `runtimeRestart`, `buildStart`, `gitPushBranch`, and `taskTransition`.

## Generated images

`state/queries/agent-generated-images.ts` keys image reads by repository, runtime, working directory, session, turn, item, and output revision. It caches a Blob with `staleTime: Infinity` and `gcTime: 0`. It disables refetch on mount because each output revision has its own query.

Visible previews share a history read in batches of up to eight distinct images. Each runtime holds at most two batches. Each batch admits sources up to 96 MiB, counting two bytes per inline string character, and expires after two minutes. Two reserved batches cap retained inline sources at 192 MiB per runtime. The frontend queues excess images until the batch releases. The reservation remains held until active resolver work stops. This limit excludes the runtime public-history response. Individual reads consume those sources through the two-slot preview queue. Completion, cancellation, session release, and runtime release discard the batch. Batch IDs do not form part of query keys.

History restores saved-file identity without opening or hashing files. Visible cards request saved-file metadata through a separate TanStack Query entry. The host worker hashes the file bytes for that request. A successful history refresh invalidates metadata for that exact session. The host checks the digest again when it reads a preview. A file-read failure leaves generation completed and removes preview availability. The renderer requests saved-file metadata by session and item identity; it does not supply paths for file access.

Visible saved-image metadata requests share a describe call for the same reader and session, with at most 64 identities per call. These calls use the existing two-slot preview queue. Metadata uses the default 10-minute inactive cache lifetime and stays fresh until a successful history refresh invalidates it. An invalidated offscreen entry refreshes when its card returns. Blob entries still use `gcTime: 0`.
