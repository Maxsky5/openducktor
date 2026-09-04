# Architecture and data flow

Use this document to find the owner of a rule and trace a user action across packages.

OpenDucktor supports OpenCode, Codex, and Claude runtimes. OpenCode is the default. `packages/frontend` is the shared UI. Electron and `packages/openducktor-web` provide the shells. `packages/host` serves both shells. Windows and Linux desktop builds remain experimental.

## Layer ownership

| Layer | Main code | Owns | Does not own |
|---|---|---|---|
| UI | `packages/frontend/src/pages`, `packages/frontend/src/components` | Rendered state and local interaction | Workflow rules and status transitions |
| Frontend state | `packages/frontend/src/state/app-state-provider.tsx`, `packages/frontend/src/state/operations/*` | UI state, operations, host session projection, selected history | Schemas, task mutations, source live runtime state |
| Contracts | `packages/contracts/src/*` | Zod schemas for tasks, sessions, workflows, host commands, and MCP data | Runtime control and workflow policy |
| Core | `packages/core/src/ports/agent-engine.ts`, `packages/core/src/services/*`, `packages/core/src/types/agent-orchestrator.ts` | Ports, role policy, tool mapping, prompt helpers | Shell calls and task-store adapter calls |
| Clients and runtime adapters | `packages/host-client/src/*`, `packages/adapters-opencode-sdk/src/*`, `packages/adapters-codex-app-server/src/*` | Host client and native runtime protocols | Workflow policy and shell transport |
| Host | `packages/host/src/*` | Command router, Effect services, live session state, runtimes, process, files, Git, task store, and MCP | Frontend cache and public schemas |
| Shells | `apps/electron/src/*`, `packages/openducktor-web/src/*` | IPC, preload, HTTP/SSE, renderer start, URLs, and previews | Workflow policy and task-store rules |
| MCP | `packages/openducktor-mcp/src/*` | stdio, schema checks, bridge readiness, and `odt_*` calls | UI state and direct SQLite access |

## Shell startup

`packages/frontend` exports `bootstrapOpenDucktorShell(...)` and the `ShellBridge` contract. The bootstrap sets the bridge, reads settings for the theme, selects browser or hash routing, and renders the app.

`apps/electron` supplies IPC, preload events, context isolation, renderer sandboxing, and host cleanup. `packages/openducktor-web` starts a loopback host, injects config, serves the frontend, and maps HTTP/SSE to the same bridge.

## Shared ownership rules

- Zod schemas in `packages/contracts` define public data.
- Effect defines host execution, typed failures, resources, and Promise conversion.
- TanStack Query defines frontend cache keys, stale times, in-flight request deduplication, and invalidation.
- React context and local stores hold UI state. Host runtime adapters hold the source live session state.

Read [ADR 0002](adr/0002-use-effect-in-the-typescript-host.md) and [the TanStack Query cache strategy](tanstack-query-cache-strategy.md) before you change these boundaries.

## List tasks for the Kanban board

1. `useTaskQueryReadModel` observes `repoTaskDataQueryOptions`. The initial stream snapshot fills the shared query cache. The render query reuses this data without a second request. If the stream cannot start, the repository load fills the cache. Manual and event refreshes use `TaskViewSync`.
2. `repoTaskDataQueryOptions` calls `host.tasksList(repoPath)`. The host reads `kanban.doneVisibleDays`, and SQLite filters old closed tasks before the host builds task rows.
3. `packages/frontend/src/lib/host-client.ts` delegates to the active shell bridge.
4. `packages/host-client/src/task-client.ts` maps the call to `tasks_list`.
5. The shell calls the host command router.
6. The host resolves the workspace, opens `<config-root>/task-stores/<workspaceId>/database.sqlite`, and reads through `TaskStorePort`.
7. The host adds `available_actions` and `agent_workflows`.
8. TanStack Query caches the result. Frontend read models render columns and actions.

The frontend renders `availableActions`. It does not derive transition rights from status. Host SQLite adapters own database paths, schema setup, records, and cache invalidation.

## Start an agent session

1. Agent Studio calls `startAgentSession` in `use-agent-orchestrator-operations.ts`.
2. `start-session.ts` applies `fresh`, `reuse`, or `fork` rules.
3. `session-start-launch-options.ts` resolves the mode for the selected launch action.
4. A fresh or forked session reads task documents, resolves the runtime, and reads the repository default model.
5. Every fresh workflow role uses the task-session bootstrap. The first role creates the canonical task worktree and runs copy paths and pre-start hooks. Later roles check and reuse that worktree. The runtime stays repository-scoped, but the session uses the worktree. Only Builder completion moves the task to `in_progress`.
6. The host starts the selected runtime. Descriptors and `RuntimeInstanceSummary` form the shared contract. OpenCode uses `local_http`; Codex uses stdio app-server; Claude uses a host service.
7. A managed runtime MCP process gets the host bridge URL and token. It cannot pass `workspaceId`. An external client can pass `workspaceId`. Neither path gets a database path.
8. The host starts, resumes, or forks through the registered live-session adapter.
9. Renderer attachment sends one snapshot first, then ordered changes and transcript events on the same channel.
10. On send, the adapter applies the role policy and writes the native request.
11. For a workflow session, the host stores the durable session record from the successful runtime control result before it returns the result to the frontend. Live activity, pending input, context, routes, and reply IDs remain in host memory.

Session rules:

- `spec`, `planner`, and `qa` reject mutating permission requests. If the reply fails, keep the request open and emit a system error.
- Before host control succeeds, stale workspace protection stops session preparation. After host control succeeds, cleanup can stop the runtime, but it must keep the stored task session and its worktree resources.
- Register and start the live adapter before the runtime can emit events. Release it when the runtime stops.
- Read transcript history only for the selected session. A history read does not discover pending input or delay live state.

## Change task workflow state

Human and agent actions meet in the host workflow service. SQLite stores the result.

For a human action:

1. The user selects an action from `availableActions`.
2. The frontend calls a host method such as `taskTransition`, `humanApprove`, or `buildCompleted`.
3. The shell maps the method to a host command.
4. The host workflow service checks the transition.
5. The task store writes status, fields, or documents.
6. The frontend refreshes tasks and renders the new action list.

For an agent tool:

1. The session calls an `odt_*` tool on the local `openducktor` MCP server.
2. `packages/openducktor-mcp` checks input with `ODT_TOOL_SCHEMAS`.
3. `OdtTaskStore` forwards the call to the host bridge. For an external client, the host maps `workspaceId` to `repoPath`.
4. The host workflow service checks the action and writes through the task store.
5. The tool result enters the session stream.
6. The frontend sees the completed mutation tool and refreshes tasks.

Managed and external MCP clients use the same bridge. The host alone owns SQLite. Repository sessions get all `ODT_MCP_TOOL_NAMES` and use runtime approval rules. Task workflow sessions keep their role tool limits and cannot call public task tools.

## Generate a pull request

1. The approval flow starts Builder with `build_pull_request_generation`.
2. The launch uses `reuse` or `fork` from an existing Builder session.
3. Builder uses provider Git or GitHub tools to create or update the pull request.
4. Builder calls `odt_set_pull_request`.
5. The host resolves `providerId` and pull request number, then stores the canonical metadata.

The page does not parse chat text to create a pull request.

## Sources of truth

| Concern | Source | Owner |
|---|---|---|
| Task status, issue type, action ID | `packages/contracts/src/task-schemas.ts` | Contracts |
| Role and start mode | `packages/contracts/src/agent-workflow-schemas.ts` | Contracts |
| ODT tool names and schemas | `packages/contracts/src/odt-tool-names.ts`, `packages/contracts/src/odt-mcp-schemas.ts` | Contracts |
| Role tool list | `AGENT_ROLE_TOOL_POLICY` | Core |
| Workflow rules and derived actions | `packages/host/src/domain/task/*`, `packages/host/src/application/tasks/*` | Host |
| Task state | SQLite `tasks.status` | Host SQLite adapter |
| Database identity | `<config-root>/task-stores/<workspaceId>/database.sqlite` | Host SQLite infrastructure |
| Documents and durable session records | SQLite task and document rows | Host task services |
| Live session state and reply routing | `packages/host/src/application/agent-sessions/*`, `packages/host/src/adapters/agent-sessions/*` | Host runtime adapter |
| Renderer session view | `packages/frontend/src/state/operations/agent-orchestrator/session-read-model/*` | Frontend projection |
| Transcript history | Selected runtime history adapter | Runtime adapter |
| Host execution errors | Effect and tagged errors in `packages/host/src` | Host |
| Frontend server-read cache | Query modules under `packages/frontend/src/state/queries` | Frontend |

## Replaceable boundaries

- Agent engine ports in `packages/core/src/ports/agent-engine.ts`.
- Live-session port in `packages/host/src/ports/agent-session-live-adapter-port.ts`.
- Native runtime code in `packages/adapters-opencode-sdk`, `packages/adapters-codex-app-server`, and `packages/host/src/adapters/claude`.
- SQLite `TaskStorePort` code under `packages/host/src/adapters/sqlite`.

## Cross-layer change order

1. Change a shared data shape in `packages/contracts` first.
2. Change ODT names or workflow schemas in contracts, core policy, adapters, host, MCP, and UI together.
3. Change public MCP schemas and package docs together.
4. Change host task policy before workflow docs and UI mapping.
5. Keep policy in host domain or application code. Shells only map transport.
6. Keep task lifecycle and database paths in the host.
