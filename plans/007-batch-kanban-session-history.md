# 007 — Batch Kanban session-history reads

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: MEDIUM
- **Category**: Performance
- **Rule**: Beyond the scan
- **Estimated scope**: about 18 production/test-support files and 10 focused test files, roughly 300–450 lines

## Problem

Kanban creates one TanStack Query observer per task:

```tsx
// packages/frontend/src/pages/kanban/use-kanban-page-models.ts:141 — current
const kanbanTasks =
  workspaceRepoPath && !settingsSnapshotQuery.isError ? tasks : EMPTY_KANBAN_TASKS;
const kanbanTaskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
const shouldLoadHistoricalSessions = workspaceRepoPath !== null && kanbanTaskIds.length > 0;
const historicalSessionQueries = useQueries({
  queries:
    shouldLoadHistoricalSessions && workspaceRepoPath
      ? kanbanTaskIds.map((taskId) => agentSessionListQueryOptions(workspaceRepoPath, taskId))
      : [],
});
```

Each query calls a per-task host method:

```ts
// packages/frontend/src/state/queries/agent-sessions.ts:14 — current
export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });
```

The host client implements that method by loading the full metadata for one task:

```ts
// packages/host-client/src/task-client.ts:300 — current
async agentSessionsList(repoPath: string, taskId: string): Promise<AgentSessionRecord[]> {
  const payload = await this.readTaskMetadata(repoPath, taskId);
  return payload.agentSessions;
}
```

Thus `N` Kanban tasks can produce `N` IPC commands and `N` SQLite task reads. Card virtualization does not reduce these board-level queries. The existing `loadAgentSessionListsFromQuery` also uses `Promise.all` over per-task reads and does not fix the root cause.

## Target

Add one read-only batch interface that performs one frontend query, one host command, and one SQLite `WHERE id IN (...)` read. Do not change durable task/session storage.

Add the non-durable response contract in `packages/contracts/src/session-schemas.ts`:

```ts
export const taskAgentSessionsSchema = z.object({
  taskId: z.string(),
  agentSessions: z.array(agentSessionRecordSchema),
});

export type TaskAgentSessions = z.infer<typeof taskAgentSessionsSchema>;
```

Use these names through the stack:

```ts
type ListAgentSessionsForTasksInput = {
  repoPath: string;
  taskIds: string[];
};

// host port
listAgentSessionsForTasks(
  input: ListAgentSessionsForTasksInput,
): Effect.Effect<TaskAgentSessions[], TaskStoreError>;

// host service/command/client
agentSessionsListForTasks(input)
"agent_sessions_list_for_tasks"
host.agentSessionsListForTasks(repoPath, taskIds)
```

The SQLite adapter must issue one query against existing task rows and decode each row's existing `agent_sessions_json` through the current `agentSessionsFromRow`. No migration, table/column change, or durable record transformation is permitted.

Add one normalized TanStack Query key:

```ts
const normalizeTaskIds = (taskIds: string[]): string[] =>
  Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort();

export const agentSessionQueryKeys = {
  // existing keys
  batches: (repoPath: string) =>
    [...agentSessionQueryKeys.all, "list-for-tasks", repoPath] as const,
  listForTasks: (repoPath: string, taskIds: string[]) =>
    [...agentSessionQueryKeys.batches(repoPath), normalizeTaskIds(taskIds)] as const,
};
```

`agentSessionListsQueryOptions` must return a task-ID keyed record, pre-seeding every requested ID with `[]` so deleted/missing tasks have an explicit empty result. Invalid persisted session data must still fail decoding.

Replace Kanban's `useQueries` with one `useQuery(agentSessionListsQueryOptions(...))`, then derive the existing `Map<string, AgentSessionRecord[]>` interface.

## Repo conventions to follow

- Define public Zod contracts in `packages/contracts`; do not duplicate them with Effect Schema.
- Keep host I/O Effect-native and errors typed.
- Keep TanStack Query as the frontend cache/deduplication owner.
- Preserve the existing per-task API and query key for Agent Studio, task details, and orchestration.
- Follow command parsing/registration patterns in `packages/host/src/interface/commands` and host-client parsing patterns in `packages/host-client`.

## Steps

1. Add `taskAgentSessionsSchema` and `TaskAgentSessions` to `packages/contracts/src/session-schemas.ts`, plus contract/export tests.
2. Add `ListAgentSessionsForTasksInput` to `packages/host/src/application/tasks/task-inputs.ts` and a parser in `packages/host/src/interface/commands/task-command-inputs.ts`. Trim IDs, remove empty values, de-duplicate, and preserve an empty-list fast path.
3. Add `listAgentSessionsForTasks` to the appropriate task-reader/session repository port in `packages/host/src/ports/task-repository-ports.ts`.
4. Implement the batch read beside existing session persistence in `packages/host/src/adapters/sqlite/sqlite-task-agent-sessions.ts`. Use one `inArray(tasks.id, taskIds)` query and `agentSessionsFromRow` for decoding.
5. Wire the method through `sqlite-task-repository.ts`. Return `[]` without touching SQLite for an empty normalized ID list.
6. Expose `agentSessionsListForTasks` through `createTaskQueryUseCases`/`TaskService`.
7. Register and handle `agent_sessions_list_for_tasks` in `host-command-registry.ts` and `task-command-handlers.ts`.
8. Add `agentSessionsListForTasks(repoPath, taskIds)` to `HostTaskClient`, parse the new contract, and expose it in `TASK_METHODS`. Do not route it through the task-keyed metadata cache.
9. Extend `packages/frontend/src/state/queries/agent-sessions.ts` with normalized batch keys and `agentSessionListsQueryOptions`.
10. Make batch results satisfy these invariants: requested missing IDs map to `[]`; records retain current newest-first ordering; invalid records fail; task ordering changes do not create a distinct cache key.
11. Extend `upsertAgentSessionRecordInQuery` so it updates the per-task cache and any repository batch cache containing that task.
12. Extend `invalidateAgentSessionListQuery` so per-task invalidation also invalidates repository batch queries with the same `refetchActive` policy.
13. Replace `useQueries` in `use-kanban-page-models.ts` with one batch `useQuery`; preserve the current `Map` passed to board models and replace the array error scan with the single query error.
14. Update all structural `TaskStorePort` test doubles surfaced by typecheck with explicit implementations. Expected locations include Electron host tests, the task workflow harness, and task-service test files.
15. Add focused tests:
    - contracts: valid response and invalid nested session rejection;
    - SQLite port: multiple tasks in one call, duplicates, empty IDs, and missing tasks;
    - task service/command: normalized IDs and one port call;
    - host client: one command invocation and response parsing;
    - frontend query: normalized key, one host call, empty defaults, upsert coherence, and invalidation coherence;
    - Kanban page: two or more tasks produce exactly one batch call and receive correctly keyed histories.
16. Run full typecheck after the port change to find every structural test adapter.

## Boundaries

- **No database migration, Drizzle schema change, persisted record schema change, or durable data transformation.** If implementation requires any of these, stop and obtain explicit human approval.
- Do not add historical sessions to `TaskCard`.
- Do not remove the existing per-task `agentSessionsList` method or query key.
- Do not change the 100-record retention policy, session identity, ordering, or selected-model equivalence.
- Do not make history lazy per card; cards currently need history for roles and resume/open-session actions.
- Do not hide the fan-out with a longer stale time, `Promise.all`, retries, or a frontend in-flight map.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `bun test packages/contracts/src/runtime-schemas.test.ts packages/contracts/src/exports.contract.test.ts --max-concurrency=1`
  - `bun test packages/host/src/adapters/sqlite/sqlite-task-store-port-contract.test.ts packages/host/src/application/tasks/task-service-list-and-sessions.test.ts packages/host/src/interface/commands/task-command-handlers.test.ts --max-concurrency=1`
  - `bun test packages/host-client/src/index.test.ts --max-concurrency=1`
  - `bun test packages/frontend/src/state/queries/agent-sessions.test.ts packages/frontend/src/pages/kanban/kanban-page.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `npx -y react-doctor@latest . --diff main --yes` does not lower the score.
- **Profiler/runtime check**: Open a board with multiple tasks and inspect the host command stream. Confirm one `agent_sessions_list_for_tasks` command for the normalized ID set and no burst of per-task `task_metadata_get` calls. Confirm card session roles and resume/open targets remain correct.
- **Done when**: Kanban uses one batch query/read, all cache shapes remain coherent, no durable schema changed, and focused/full checks pass.
