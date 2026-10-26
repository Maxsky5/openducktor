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

`packages/frontend-core/src/connection/client-query-client.ts` sets:

- `retry: false`
- `refetchOnWindowFocus: false`
- `refetchOnReconnect: false`
- `staleTime: 60_000`
- `gcTime: 10 * 60_000`

These values stop hidden retries and surprise traffic after focus or reconnect. Each query group can replace the default stale time.

Each host connection creates its own query client with `createClientQueryClient()`. A query function reads the host from its context with `connectionHost(client)`, so a cache and its reads always use the same host connection. Two hosts with identical repository paths therefore never share cache entries. Code outside a query function receives the query client or the host client as a parameter. A component or hook reads them with `useQueryClient`, `useHostClient`, or `useClientConnection`.

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

Query modules: `workspace.ts`, `runtime.ts`, and `runtime-catalog.ts` under `packages/frontend-core/src/queries`.
The runtime catalog and repository config load on the first visit to a workspace. They have no timed cache eviction while that workspace is open. A later visit shows the cached data at once and reads stale data again in the background. Closing or removing a workspace cancels pending reads and removes its runtime catalogs and repository config. Model catalog previews outside an open workspace keep their 60-minute inactive lifetime.

Runtime catalog reads follow these rules:

- A live runtime catalog read starts only when the host status of its runtime kind is `ready`.
- Read a live catalog through `useRuntimeCatalogQuery`, `useRuntimeModelCatalogQuery`, `useRuntimeModelCatalogs`, or `useRefreshStaleRuntimeCatalog`. Each of these hooks applies the readiness check.
- A catalog view does not show an earlier read error or offer Retry while its runtime is not ready.
- Delegation reads without the readiness check. It shows the host error.
- A model catalog preview does not use the shared runtime. It does not wait for readiness.
- A view shows a cached catalog during a background refresh.
- A view shows no loading state during a background refresh.
- A view shows a loading state only when it has no catalog yet.
- The model picker shows one loader for all runtimes that have no catalog yet.
- When a model catalog refresh fails, a view keeps the cached models visible and selectable.
- A failed model catalog refresh shows its error with a retry action.
- These two rules apply to a rejected read and to a read that returns failed models.
- For a read that returns failed models, the catalog query function keeps the previous models.
- Other catalog surfaces hide cached data after a failed read.

### Workflow data

| Data | Stale time |
|---|---:|
| Task list and runs | 30 sec |
| Runs | 30 sec |
| Agent session list | Infinity |
| Task documents | 60 sec |
| Task approval context | 60 sec |
| Host runtime and MCP bridge status | Infinite, updated by events |
| Saved Autopilot rules | Infinite, invalidated by events |

Task details and editing use `unfilteredRepoTaskDataQueryOptions` and `tasksListAll`, with a separate cache key from the retained Kanban list. Task events carry changed cards, including closed tasks outside Done retention. Both lists apply these cards and removals without another host read; only the Kanban list applies the event cutoff. A stream gap marks the complete list incomplete before the board read starts. Later events cannot make that baseline fresh. Observed complete lists read again during recovery; inactive lists wait for their next view. A successful full read clears the incomplete state.

Agent session lists stay fresh until a task event invalidates them or an explicit refresh requests current records. Session-list queries do not retry on mount after a failure. A failed list stays active in its view, so a later task event reads it again.

Agent history uses an infinite stale time while the workspace live stream proves its coverage version is current. History with no proven coverage uses a zero stale time.

Each task has its own session-list query. The query function sends its read through a shared batch in `agent-session-list-batch.ts`. Reads of one workspace that start before the next microtask share one `agentSessionsListForTasks` request. Each workspace has at most one session-list request in progress. Reads that start during that request share the next request. The batch rejects a response that omits a requested task, repeats a task, or adds a task.

The host fails a whole request when one requested task is missing. If a deletion of a requested task is confirmed during that request, the other reads go into the next request. If the deletion is confirmed after the failure, the deletion event reads again the lists that failed in the same request. A failure without a deletion fails every read of the request with its cause.

The batch keeps a revision for each task list. A task event advances the revisions of its tasks when the stream receives the event. A read that was sent before that point reads again before it completes. Query stores a read result some microtasks after the host response. A read that is pending when an event arrives reads again until it reflects the latest revision. The event completes after the observed lists and the pending reads of its tasks reflect it, also when those reads have no view. A pending read keeps this need until the read operation settles. A confirmed deletion completes the pending reads of its task with an empty list.

The task stream starts the session-list work of each consecutive event when it receives the event. Events that arrive before a request starts share that request. The stream completes and acknowledges events in cursor order. A live refresh records the session ownership of the cached lists when it enters the client queue. A later event shares that live refresh when its changed tasks still have that ownership, and starts a new one only for newer ownership.

Each query client sends one live refresh at a time, including across replacement stream owners. This matches the host's single refresh lane without holding browser connections for waiting work. Before a queued refresh starts, it checks the stream owner, stream epoch, workspace epoch, and whether the workspace remains open. A failed refresh reaches its caller and does not stop the queue.

When a replacement snapshot arrives, the stream cancels all session-list reads and advances the batch epoch. Work that started before the snapshot does not store records, start a live refresh, or report success. A read whose response returned before the snapshot cannot be cancelled. If it has no older list to keep, its query goes back to its first state. A stopped stream starts no live refresh for the events or the snapshot that it started.

Query modules: `tasks.ts`, `agent-sessions.ts`, `documents.ts`, `task-approval.ts`, `runtime.ts`, `host-runtime-status.ts`, and `autopilot.ts`.

The saved Autopilot rules have their own entry, apart from the settings snapshot, so no settings mutation writes or cancels them. The `autopilot_settings_saved` run event and a reconnect after missed events invalidate the entry.

The `openducktor://runtime-changed` event stream owns host runtime status and MCP bridge status after the first read. Merge each event into the cached snapshot by host instance and revision. Do not poll it.

Session records include the saved `lastActivityAt`. A `task_session_records_updated` event replaces the task's cached session list after commit. It also cancels the read in progress for that task. The query options use `structuralSharing` to keep a committed list when an older read result arrives after the update. A caller that joined the cancelled read receives the committed list. Workspace session updates use their existing record event. These updates do not trigger another read.

A task event updates the cached task list of its workspace, also when the workspace is inactive. It invalidates the session lists of its tasks. Only lists that a view observes read again at once, such as the session list in all-workspaces scope. A stream snapshot keeps the session-list queries that a view observes in every workspace, and reads them again in place. It removes the other lists. A failed read of the observed lists fails the snapshot. The Kanban task list hides older done tasks. In each open workspace, the snapshot checks the tasks that the Kanban list omits but that have a cached list or workflow session state. It reads `taskIdsList` and removes the session state only of the tasks that no longer exist.

A confirmed deleted task keeps an empty list while a view observes it. Later reads of that task return the empty list without a host request, also after a live reconnection. An event that keeps the task or a snapshot that lists it ends this state.

### Open workspace task lists

The app keeps the task list of every open workspace in the cache, so a workspace switch shows its tasks at once. `useAppLifecycle`, `useOpenWorkspaceTaskLists`, and the task stream controller apply these rules.

Only open workspaces get new reads and live work. When a workspace closes, its release supersedes the reads requested before it. These reads store no data and report no failure.

- `useOpenWorkspaceTaskLists` observes the task list of each open workspace with a disabled observer. The cache does not remove an observed list, and an active-query read such as a reconnect skips it.
- `useAppLifecycle` reads the list of an inactive open workspace that has no read yet, unless a stream snapshot reads it. This includes a workspace that lost focus before its first load as the active workspace. The active workspace reads its list after its task store check.
- The task stream keeps these lists current. A stream gap or a Done-retention change can make a list miss changes. When its full reload fails, the list keeps its failure and applies task events only after its next successful read.
- A stream snapshot reads the task list and the observed documents of every open workspace again. Then it updates the session lists of each open workspace, as the session rules above describe, and refreshes its live sessions.
- The active workspace also reads all of its session lists after a snapshot, because the agent orchestrator reads them from the cache. Other workspaces read the lists that a view shows.
- A failed task list read or document read of one workspace stays in its query and does not stop the snapshot of the other workspaces. The app names the failed workspaces in a "Workspaces did not refresh" notification and keeps the stream open. A failed read of an observed session list fails the whole snapshot, as the session rules above describe.
- No lifecycle load reads a task list again after its snapshot read failed. The list keeps the failure until a manual refresh, a Done-retention change, the next snapshot, or a reopen of the workspace.
- A Done-retention change reads the task list of every open workspace again.
- When a workspace closes, the task stream controller cancels its reads at once and removes its task lists, documents, and session lists. A snapshot or a task event batch that runs during the close does not update the sessions of the workspace. It starts no live refresh and reports no failure for that workspace. It still completes for the other workspaces.
- The active workspace stays open until the next workspace becomes active.

### Checks and file data

| Data | Stale time |
|---|---:|
| PATH check | 5 min |
| Git check | 5 min |
| Task store check | 60 sec |
| Directory listing | 1 sec |
| Branches | 60 sec |
| Current branch | 60 sec |
| Worktree status | 0, Infinity in session Git panels |
| Local changes | 0, Infinity in session Git panels |
| Git History pages | Infinity, invalidated by refresh and Git actions |

History uses one infinite query for each directory, checkout, and target reference. A new revision of the same branch shows the previous graph as placeholder data until its own first page loads. Each later page sends the branch tips of the first page, so a moved tip fails the page instead of mixing two graphs. Refresh and Git actions invalidate History for the directory.

Use a zero stale time for general worktree status reads. Session Git panels key local changes and Branch changes by directory, branch name or detached HEAD, and target, not by commit, so a new commit keeps the shown data while it reads again. They observe these reads with an infinite stale time, so a return to the same repository, directory, branch, target, and scope shows the cached result. Session activation does not refresh these reads. Manual refresh, file events, Git actions, and focus refresh check Git and read again or invalidate the cache. On mobile, a screen that shows changes runs a soft refresh each time it gets navigation focus, because the host sends no file event for an edit in a terminal or an editor. When a session of an open workspace ends a turn, its working directory loses the freshness of its Git reads and file reads, also when no view shows that session. A tool call that edits files or runs a command does the same during the turn, once each burst of calls settles for one second. A shown view reads again at once, and a hidden view reads when it shows. A refresh that cannot read a hidden or changed view marks the reads of that view stale, so the view reads when it shows again. Stage, Unstage, and Discard return the local changes after the write. The panel cancels an older unfinished local read, stores the result with `setQueryData`, and invalidates Branch changes, because the index can change how they list a file. These changes keep History, because they make no commit. Cancel unfinished status reads when their context ends. A closed panel keeps them. Keep view guards separate from cache keys so late reads cannot enter a new view. An unknown branch shows a pending or unavailable label. Only a completed read can show a detached branch.

A branch read that finds a new commit on the same checkout reads the shown local changes, Branch changes, and comparison check again, because their keys do not change. A rebase detaches HEAD and attaches it again, which changes these keys. A read under the new key shows the result that it continues as placeholder data until its own result arrives, when the new or the previous checkout is a detached HEAD. A branch read that finds another checkout removes the inactive reads of an earlier visit to that checkout, because they predate the change. A change to another named branch starts without data.

Query modules: `checks.ts`, `filesystem.ts`, and `git.ts`.

Workspace activation shows the cached branch at once and reads the current branch and branch list again with a zero stale time. The branch-sync probe checks only the active repository on focus or visibility changes. It does not poll or check inactive repositories.

## Read methods

Use `ensureQueryData` for configuration that can return a fresh cached value. Examples are `loadSettingsSnapshotFromQuery(...)` and `loadRepoConfigFromQuery(...)`.

Use `fetchQuery` for an imperative read that still needs the shared key and in-flight deduplication. Examples include task refresh, session history, documents, and worktree status.

Use `prefetchQuery` to warm the cache for a read that the user is likely to need next.

Task documents use a 60 second stale time for normal views. Workflow refreshes force a new fetch through `packages/frontend-core/src/queries/documents.ts` so an external ODT write appears without polling.

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

## Local images

`state/queries/local-images.ts` keys each host image by its path. A read keeps its data with `staleTime: Infinity` and `gcTime: 0`, so the data goes away when no view shows the image. A browser card reads its screenshot only after the user opens it.

## Generated images

`state/queries/agent-generated-images.ts` keys image reads by repository, runtime, working directory, session, turn, item, and output revision. It caches a Blob with `staleTime: Infinity` and `gcTime: 0`. It disables refetch on mount because each output revision has its own query.

Visible previews share a history read in batches of up to eight distinct images. Each runtime holds at most two batches. Each batch admits sources up to 96 MiB, counting two bytes per inline string character, and expires after two minutes. Two reserved batches cap retained inline sources at 192 MiB per runtime. The frontend queues excess images until the batch releases. The reservation remains held until active resolver work stops. This limit excludes the runtime public-history response. Individual reads consume those sources through the two-slot preview queue. Completion, cancellation, session release, and runtime release discard the batch. Batch IDs do not form part of query keys.

The Codex runtime keeps the completed images with a saved file from the last history read of each session. A later batch or describe call of only these images reads no history. These records hold no image bytes, and the host checks the digest when it reads the file. Session release and runtime release discard them.

History restores saved-file identity without opening or hashing files. Visible cards request saved-file metadata through a separate TanStack Query entry. The host worker hashes the file bytes for that request. A successful history refresh invalidates metadata for that exact session. The host checks the digest again when it reads a preview. A file-read failure leaves generation completed and removes preview availability. The renderer requests saved-file metadata by session and item identity; it does not supply paths for file access.

Visible saved-image metadata requests share a describe call for the same reader and session, with at most 64 identities per call. These calls use the existing two-slot preview queue. Metadata uses the default 10-minute inactive cache lifetime and stays fresh until a successful history refresh invalidates it. An invalidated offscreen entry refreshes when its card returns. Blob entries still use `gcTime: 0`.

The mobile app writes each host image to a device cache file and keeps only the file URI in the query. These reads use the default 10-minute inactive cache lifetime, so a row that scrolls back shows its image without a new read. A read leaves the cache, and its file goes away, 10 minutes after its last view closes.
