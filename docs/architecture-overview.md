# End-to-End Architecture and Data Flow

## Purpose

This document is the maintainer-facing map of how OpenDucktor moves data across layers, from the shared React UI through shell bridges, host services, SQLite-backed task persistence, runtime adapters, and MCP clients.

Use it to answer:

- which layer owns a rule
- where to change code safely
- what runtime path a user action follows

Current scope:

- Supported runtime kinds today are OpenCode (`opencode`) and Codex (`codex`).
- OpenCode remains the default runtime.
- OpenDucktor is macOS-first and early-stage. Windows and Linux Electron builds exist, but they are experimental and not stable yet.
- `packages/frontend` is the shared UI.
- `apps/electron` and `packages/openducktor-web` are the shell adapters for Electron and local browser mode.
- `packages/host` is the TypeScript host for Electron and browser mode.

## Layer Map

| Layer | Primary modules | Owns | Must not own |
|---|---|---|---|
| UI presentation | `packages/frontend/src/pages`, `packages/frontend/src/components` | Rendering, local interaction state, visual workflow affordances | Workflow authority, status transition rules |
| Frontend state/orchestration | `packages/frontend/src/state/app-state-provider.tsx`, `packages/frontend/src/state/operations/*` | App-level state slices, async operation orchestration, session hydration | Persisted schema definitions, task-store mutation semantics |
| Shared contracts | `packages/contracts/src/*` | Runtime-validated schemas for tasks, sessions, workflows, host commands, and MCP payloads | Runtime orchestration, host process control |
| Core services and ports | `packages/core/src/ports/agent-engine.ts`, `packages/core/src/services/*`, `packages/core/src/types/agent-orchestrator.ts` | `AgentEnginePort`, role/tool policy, tool normalization, prompt composition helpers | Shell invocation details, task-store adapter calls |
| Host client and runtime adapters | `packages/host-client/src/*`, `packages/adapters-opencode-sdk/src/*`, `packages/adapters-codex-app-server/src/*` | Typed host-command client plus OpenCode/Codex `AgentEnginePort` adapters | Business workflow policy ownership, shell transport ownership |
| TypeScript host | `packages/host/src/*` | Electron/web host command router, Effect-native application services, ports, infrastructure adapters, runtime/process/filesystem/git/MCP orchestration | Frontend cache ownership, public contract schema ownership |
| Shells | `apps/electron/src/*`, `packages/openducktor-web/src/*` | Electron IPC/preload, browser HTTP/SSE bridge, renderer entrypoints, open-url/local-preview behavior | Domain workflow policy, task-store ownership |
| MCP workflow service | `packages/openducktor-mcp/src/*` | MCP stdio transport, shared schema validation, host-bridge readiness checks, host-backed `odt_*` task/workflow calls | Frontend rendering/state, task-store persistence ownership |

## Shell Bootstrap Boundary

`packages/frontend` owns the shell-neutral React bootstrap through `bootstrapOpenDucktorShell(...)` and the `ShellBridge` contract. It configures the bridge, preloads settings for theme setup, selects browser or hash routing, and renders the shared app. Shell packages stay thin:

- `apps/electron` provides Electron IPC/preload/event forwarding, context isolation, sandboxed renderer setup, and host lifecycle disposal.
- `packages/openducktor-web` starts a loopback TypeScript host backend, injects runtime config, serves the frontend, and maps browser HTTP/SSE transport to the same shell bridge shape.

## Effect, Zod, and TanStack Query Ownership

OpenDucktor uses Effect in `packages/host` for internal execution: typed failures, dependency wiring, fallible I/O orchestration, lifecycle cleanup, and explicit Promise interop at shell-facing boundaries.

Effect does not replace the public schema layer. `packages/contracts` remains the Zod-backed source of truth for runtime, task, workflow, host-bridge, and MCP payload shapes. If a host operation uses Effect internally, it still accepts and returns the same contract-defined payloads at public boundaries.

Effect also does not replace frontend read caching. TanStack Query owns frontend cache keys, stale-time policy, in-flight deduplication, and invalidation for server-owned reads. Effect may run behind a host client or query function, but it must not create a competing frontend cache for the same data.

The intended boundary is:

- Zod owns public data contracts.
- Effect owns host-side execution and failure modeling.
- TanStack Query owns frontend server-read caching.
- React context and local UI stores own transient UI state and live interaction state.

See [ADR 0002](adr/0002-use-effect-in-the-typescript-host.md) and [TanStack Query Cache Strategy](tanstack-query-cache-strategy.md).

## Runtime Data Flows

### 1. List Tasks For Kanban

1. Task reads are TanStack Query-owned. `useTaskQueryReadModel` reads `repoTaskDataQueryOptions`; manual and event-driven refresh paths call `refreshRepoTaskViewsFromQuery`.
2. `repoTaskDataQueryOptions` calls `host.tasksList(repoPath, doneVisibleDays)` and derives visible task rows through frontend read models.
3. `host` is the frontend host-client proxy (`packages/frontend/src/lib/host-client.ts`), which delegates to the configured shell bridge client.
4. `packages/host-client/src/task-client.ts` maps `tasksList` to the host command `tasks_list`.
5. The active shell invokes `packages/host` and its TypeScript host command router.
6. The host task store resolves the workspace id for the repo, opens `<config-root>/task-stores/<workspaceId>/database.sqlite`, reads task rows and documents through the `TaskStorePort`, and returns task data.
7. The host task service enriches tasks with backend-derived `available_actions` and `agent_workflows`.
8. Frontend receives typed payloads, caches server-owned task reads in TanStack Query, derives visible tasks through read models, and renders columns/actions.

Key boundary:

- UI must render actions from backend `availableActions`; it must not infer transition authority from status heuristics.
- `packages/host/src/adapters/sqlite/*` and `packages/host/src/infrastructure/sqlite/*` own SQLite task-store path resolution, schema setup, task/document/session persistence, and cache invalidation.

### 2. Start An Agent Session

1. Agent Studio triggers `startAgentSession` in `use-agent-orchestrator-operations.ts`.
2. `start-session.ts` enforces explicit start-mode policy:
   - `fresh`: create a new session
   - `reuse`: continue an existing session
   - `fork`: create a new session from an existing source session
3. The session-start modal resolves the final start mode from the selected launch action in `packages/frontend/src/features/session-start/session-start-launch-options.ts`.
4. For new or forked sessions it concurrently loads task docs, resolves runtime, and loads repo default model.
5. Runtime acquisition:
   - `build` role: `host.buildStart(repo, task, runtimeKind)` creates a build worktree and starts the configured build runtime.
   - `qa` role: runtime orchestration resolves the build continuation working directory, reuses a matching running build run when available, and otherwise ensures the selected runtime for that continuation target through the shared runtime acquisition path.
   - `spec`/`planner`: `host.runtimeEnsure(repo, runtimeKind)` ensures a shared workspace runtime for the selected kind.
6. The active host resolves the requested runtime kind, then runs runtime-specific startup. The shared contract is runtime descriptors plus `RuntimeInstanceSummary`; startup mechanics are runtime-specific (`local_http` for OpenCode, stdio/app-server identity for Codex).
7. The runtime-launched MCP process uses only the host-bridge contract. It is host-scoped and forbids explicit `workspaceId`; public external MCP clients may pass `workspaceId`, but all MCP calls still go through the host bridge and never receive task-store database coordinates.
8. The selected runtime adapter starts, resumes, or forks the session and subscribes to runtime events.
9. On prompt send, adapter applies role-scoped tool gating from `AGENT_ROLE_TOOL_POLICY` and runtime-owned descriptor data, then sends the runtime-native request.
10. Session snapshots are persisted via `host.agentSessionUpsert` into task metadata for restart/reuse continuity.

Critical session invariants:

- Read-only roles (`spec`, `planner`, `qa`) must auto-reject mutating permission prompts; on auto-reply failure, permission remains actionable and a system error is emitted.
- Stale workspace protection must roll back newly started/resumed sessions with best-effort `stopSession` cleanup.

### 3. Workflow Transition

OpenDucktor has two transition paths that converge on the host workflow service as the mutation entry point and the SQLite task store as persistent truth.

Human-triggered path:

1. User clicks a workflow action surfaced from `availableActions`.
2. Frontend operation calls host method (`taskTransition`, `humanApprove`, `buildCompleted`, etc.).
3. The shell host adapter invokes the relevant host command.
4. The host workflow service validates transition rules.
5. The task store updates task status and durable task-store fields/documents.
6. Frontend refreshes tasks and re-renders with backend-derived action set.

Agent-triggered path:

1. Active OpenCode or Codex session calls `odt_*` tool through local MCP server `openducktor`.
2. `packages/openducktor-mcp` validates input against shared `ODT_TOOL_SCHEMAS`.
3. `OdtTaskStore` forwards the workspace-scoped call to the running host bridge; the host resolves `workspaceId` to `repoPath` when the call comes from an external MCP client.
4. The host workflow service validates workflow rules and persists task documents/status through the task store. The MCP package does not talk to the SQLite database directly.
5. Tool result is emitted in session stream.
6. Frontend session-event handler detects completed ODT mutation tools and triggers task refresh.

Key boundary:

- Desktop-managed and standalone MCP clients use the same host-bridge execution path.
- SQLite task storage remains a host-owned infrastructure concern, not an agent runtime or MCP client concern.
- Public MCP task tools such as `odt_get_workspaces`, `odt_create_task`, and `odt_search_tasks` are for external MCP clients. Role-scoped OpenDucktor agent sessions receive workflow tools only, and runtime adapters explicitly block the public/discovery tools.

### 4. Generate A Pull Request

1. The approval flow starts a Builder session with launch action `build_pull_request_generation`.
2. That launch action must start from an existing Builder source session and supports `reuse` or `fork`.
3. The Builder uses provider-native git or GitHub tools to create or update the PR.
4. Once the PR exists, the Builder calls `odt_set_pull_request`.
5. `odt_set_pull_request` persists canonical PR metadata into task metadata by resolving the provider record from `providerId + number`.

Key boundary:

- The page layer no longer parses Builder chat output to create a PR.
- PR generation is now an explicit launch action in the Builder workflow.

## Source-of-Truth Contracts and Ownership

| Concern | Source of truth | Owner modules |
|---|---|---|
| Task statuses, issue types, action IDs | `packages/contracts/src/task-schemas.ts` | `@openducktor/contracts`, consumed by adapters/frontend/host |
| Role and start modes | `packages/contracts/src/agent-workflow-schemas.ts` | `@openducktor/contracts` |
| Canonical ODT tool names | `packages/contracts/src/odt-tool-names.ts` and `packages/contracts/src/odt-mcp-schemas.ts` | `@openducktor/contracts`, consumed by MCP/core/adapters/host |
| Role-to-tool allowlist | `AGENT_ROLE_TOOL_POLICY` in `packages/core/src/types/agent-orchestrator.ts` | `@openducktor/core` |
| ODT/public MCP tool schema validation | `ODT_TOOL_SCHEMAS` exported from `packages/contracts/src/odt-mcp-schemas.ts` and re-exported by `packages/openducktor-mcp/src/lib.ts` | `@openducktor/contracts`, consumed by MCP/host |
| Transition legality and backend-derived actions/workflows | `packages/host/src/domain/task/*`, `packages/host/src/application/tasks/*` | `@openducktor/host` |
| Persisted task lifecycle state | SQLite `tasks.status` field | `packages/host/src/adapters/sqlite/*` through host task-store implementations |
| Workspace task-store database identity | `<config-root>/task-stores/<workspaceId>/database.sqlite` | `packages/host/src/infrastructure/sqlite/*` |
| Agent-authored docs and session snapshots | SQLite task-document rows and durable task fields | `packages/host/src/adapters/sqlite/*` and host task services |
| Host execution and expected host failures | Effect programs and tagged host errors under `packages/host/src` | `@openducktor/host`; Promise interop only at explicit transport/package boundaries |
| Frontend server-read cache | TanStack Query keys/options under frontend query modules | `@openducktor/frontend`; host/runtime Effect code must not duplicate this cache |

## Replaceable Boundaries

- TS port: `AgentEnginePort` (`packages/core/src/ports/agent-engine.ts`)
- `AgentEnginePort` adapter: `OpencodeSdkAdapter` (`packages/adapters-opencode-sdk`)
- `AgentEnginePort` adapter: `CodexAppServerAdapter` (`packages/adapters-codex-app-server`)
- Host storage: SQLite-backed `TaskStorePort` adapter under `packages/host/src/adapters/sqlite`

## Cross-Layer Change Checklist

1. If data shape changes, update `packages/contracts` first.
2. If `odt_*` tool shape or names change, update MCP schemas, core tool normalization/policy, adapter behavior, and UI assumptions together.
3. If public MCP tool shapes (`odt_create_task`, `odt_search_tasks`, `odt_read_task`, `odt_read_task_documents`) change, update package docs and public MCP schemas together.
4. If workflow transitions/actions change, update the TypeScript host task policies first, then docs and frontend rendering expectations.
5. Keep shell commands/IPC as transport/mapping layers; place policy in host application/domain layers.
6. Preserve the host task store as lifecycle source of truth; do not move lifecycle authority into UI-local state.
7. Keep MCP schemas/descriptions and host task policies aligned; MCP must delegate transition legality to the host task service.
8. Keep SQLite database paths and task-store ownership in the host; do not reintroduce storage coordinates into MCP startup or runtime-session contracts.

## Related Docs

- `docs/effect.md`
- `docs/agent-orchestrator-module-map.md`
- `docs/adr/0006-use-sqlite-task-store-with-workspace-scoped-database-path.md`
- `docs/tanstack-query-cache-strategy.md`
- `docs/runtime-integration-guide.md`
- `docs/task-workflow-status-model.md`
- `docs/task-workflow-actions.md`
- `docs/task-workflow-transition-matrix.md`
- `docs/mcp-runtime-security.md`
