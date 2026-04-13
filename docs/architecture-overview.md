# End-to-End Architecture and Data Flow

## Purpose
This document is the maintainer-facing map of how OpenDucktor moves data across layers, from React UI through the Rust host to Beads-backed persistence and MCP clients.

Use it to answer:
- which layer owns a rule,
- where to change code safely,
- what runtime path a user action follows.

Current scope note:

- The only supported runtime today is OpenCode (`opencode`).
- OpenDucktor is currently macOS-first and early-stage.

## Layer Map
| Layer | Primary modules | Owns | Must not own |
|---|---|---|---|
| UI (presentation) | `apps/desktop/src/pages`, `apps/desktop/src/components` | Rendering, local interaction state, visual workflow affordances | Workflow authority, status transition rules |
| Frontend state/orchestration | `apps/desktop/src/state/app-state-provider.tsx`, `apps/desktop/src/state/operations/*` | App-level state slices, async operation orchestration, session hydration | Persisted schema definitions, Beads mutation semantics |
| Shared contracts (TS) | `packages/contracts/src/*` | Runtime-validated schemas for tasks, sessions, workflows, IPC payloads | Runtime orchestration, host process control |
| Core domain services + ports (TS) | `packages/core/src/ports/agent-engine.ts`, `packages/core/src/services/*`, `packages/core/src/types/agent-orchestrator.ts` | `AgentEnginePort` boundary, role/tool policy, tool normalization, prompt composition helpers | Tauri invocation details, Beads CLI calls |
| Frontend adapters (TS) | `packages/adapters-tauri-host/src/*`, `packages/adapters-opencode-sdk/src/*` | Concrete host IPC adapter and OpenCode `AgentEnginePort` adapter | Business workflow policy ownership |
| Tauri command bridge (Rust) | `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/commands/*` | Typed command surface (`tauri::command`), argument mapping, command registration | Deep business policy (kept in `AppService`) |
| Host application/domain (Rust) | `apps/desktop/src-tauri/crates/host-application/src/app_service/*`, `apps/desktop/src-tauri/crates/host-domain/src/*` | Workflow transition rules, task enrichment (`available_actions`, `agent_workflows`), runtime orchestration, `TaskStore` trait | UI concerns, view-level behavior |
| Infrastructure/persistence (Rust) | `apps/desktop/src-tauri/crates/host-infra-beads/*`, `apps/desktop/src-tauri/crates/host-infra-system/*` | Beads-backed `TaskStore` persistence gateway, Beads lifecycle coordination, config/worktree/process integrations | UI workflow decisions |
| MCP workflow service (TS) | `packages/openducktor-mcp/src/index.ts`, `packages/openducktor-mcp/src/lib.ts`, `packages/openducktor-mcp/src/host-bridge-client.ts`, `packages/openducktor-mcp/src/odt-task-store.ts` | MCP stdio transport, shared schema validation, host-bridge readiness checks, host-backed `odt_*` task/workflow calls | Frontend rendering/state, Beads/Dolt lifecycle ownership |

## Platform-specific native lifecycle seams

- `apps/desktop/src-tauri/src/macos_cef_quit.rs` owns the macOS CEF quit workaround.
- That module exists because Cmd+Q enters Cocoa's native `terminate:` path before the normal red-close window teardown finishes.
- For the CEF runtime on macOS, OpenDucktor must start quit by closing windows from `terminate:` and only forward the original native terminate call after all windows are gone.
- Keep this behavior isolated from generic app shutdown logic in `lib.rs`; the signal handler and `RunEvent::ExitRequested` cleanup path are still generic, while the CEF quit interpose is a platform/runtime-specific seam.
- If this area regresses, inspect `openducktor.cef.quit` tracing first and compare Cmd+Q against red-window-close behavior before changing broader shutdown code.

## Runtime Data Flows

### 1) List tasks for Kanban
1. `useTaskOperations.refreshTasks` (frontend) validates repo readiness and calls `refreshTaskData`.
2. `refreshTaskData` requests `host.tasksList(repoPath)` and `host.runsList(repoPath)` in parallel.
3. `host` is `TauriHostClient` (`apps/desktop/src/lib/host-client.ts`), which invokes Tauri commands through `@tauri-apps/api/core`.
4. `packages/adapters-tauri-host/src/task-client.ts` maps `tasksList` to `tasks_list`.
5. `apps/desktop/src-tauri/src/commands/tasks.rs::tasks_list` calls `AppService::tasks_list`.
6. `AppService::tasks_list` ensures repo init, calls `TaskStore::list_tasks`, then enriches each task with backend-derived `available_actions` and `agent_workflows`.
7. `BeadsTaskStore` (`host-infra-beads`) ensures repo readiness through its private lifecycle subsystem, then reads from Beads via `bd`, parses metadata, and returns `TaskCard` data.
8. Frontend receives typed payloads (Zod-validated in adapter), stores them in state, and renders columns/actions.

Key boundary:
- UI must render actions from backend `availableActions`; it must not infer transition authority from status heuristics.
- `host-infra-beads/src/lifecycle/*` owns attachment verification, init/repair/restore, and custom-status provisioning; `host-infra-beads/src/store/*` owns task/document/session persistence and cache invalidation.

### 2) Start an agent session
1. Agent Studio triggers `startAgentSession` in `use-agent-orchestrator-operations.ts`.
2. `start-session.ts` enforces scenario-owned start policy:
 - `fresh`: create a new session
 - `reuse`: continue an existing session
 - `fork`: create a new session from an existing source session
3. The session-start modal resolves the final start mode from the scenario definition in `packages/contracts/src/agent-workflow-schemas.ts`.
4. For new or forked sessions it concurrently loads task docs, resolves runtime, and loads repo default model.
5. Runtime acquisition:
 - `build` role: `host.buildStart(repo, task, runtimeKind)` creates a build worktree and starts the configured build runtime; today only `opencode` is implemented.
 - `qa` role: `host.runtimeStart(runtimeKind, repo, task, "qa")` creates a task runtime for the selected kind.
 - `spec`/`planner`: `host.runtimeEnsure(runtimeKind, repo)` ensures a shared workspace runtime for the selected kind.
6. Rust host resolves the requested runtime kind, then runs runtime-specific startup. For OpenCode this starts a local loopback bridge in the desktop host and spawns the MCP server `openducktor` with `ODT_REPO_PATH` and `ODT_HOST_URL`.
7. The MCP process uses only that host-bridge contract. Direct Beads/Dolt startup inputs are rejected so storage ownership stays in the Rust host.
8. `OpencodeSdkAdapter` (`AgentEnginePort` implementation) starts, resumes, or forks the session and subscribes to OpenCode stream events.
9. On prompt send, adapter applies role-scoped tool gating from `AGENT_ROLE_TOOL_POLICY` (core) and runtime tool IDs, then sends `tools` selection to OpenCode.
10. Session snapshots are persisted via `host.agentSessionUpsert` into task metadata for restart/reuse continuity.

For the exact Beads attachment and shared Dolt startup/shutdown command sequence, see `docs/beads-shared-dolt-lifecycle.md`.

Critical session invariants:
- Read-only roles (`spec`, `planner`, `qa`) must auto-reject mutating permission prompts; on auto-reply failure, permission remains actionable and a system error is emitted.
- Stale workspace protection must roll back newly started/resumed sessions with best-effort `stopSession` cleanup.

### 3) Workflow transition
OpenDucktor has two transition paths that converge on the Rust host as the workflow mutation entry point and Beads as persistent truth.

Human-triggered path:
1. User clicks a workflow action surfaced from `availableActions`.
2. Frontend operation calls host method (`taskTransition`, `humanApprove`, `buildCompleted`, etc.).
3. Adapter invokes a Tauri command (for example `task_transition`, `human_approve`, `build_completed`).
4. Rust command delegates to `AppService`, which validates transition via `workflow_rules.rs`.
5. `TaskStore` updates Beads status/metadata.
6. Frontend refreshes tasks and re-renders with backend-derived action set.

Agent-triggered path:
1. Active OpenCode session calls `odt_*` tool through local MCP server `openducktor`.
2. `packages/openducktor-mcp` validates input against shared `ODT_TOOL_SCHEMAS`.
3. `OdtTaskStore` forwards the repo-scoped request to the running Rust host bridge; the MCP package does not talk to Beads or Dolt directly.
4. `AppService` validates workflow rules and persists Beads metadata/status through `TaskStore`.
5. Tool result is emitted in session stream.
6. Frontend session-event handler detects completed ODT mutation tools and triggers task refresh.

Key boundary:
- Desktop-managed and standalone MCP clients use the same host-bridge execution path.
- Beads and Dolt remain storage infrastructure concerns owned by the Rust host, not by agent runtimes or MCP clients.

### 4) Generate a pull request
1. The approval flow starts a Builder session with scenario `build_pull_request_generation`.
2. That scenario must start from an existing Builder source session and supports `reuse` or `fork`.
3. The Builder uses provider-native git or GitHub tools to create or update the PR.
4. Once the PR exists, the Builder calls `odt_set_pull_request`.
5. `odt_set_pull_request` persists canonical PR metadata into task metadata by resolving the provider record from `providerId + number`.

Key boundary:
- The page layer no longer parses Builder chat output to create a PR.
- PR generation is now a scenario-driven workflow step.

## Source-of-Truth Contracts and Ownership
| Concern | Source of truth | Owner modules |
|---|---|---|
| Task statuses, issue types, action IDs | `packages/contracts/src/task-schemas.ts` | `@openducktor/contracts`, consumed by adapters/frontend/host |
| Role, scenario, start mode, ODT tool IDs | `packages/contracts/src/agent-workflow-schemas.ts` | `@openducktor/contracts` |
| Role-to-tool allowlist | `AGENT_ROLE_TOOL_POLICY` in `packages/core/src/types/agent-orchestrator.ts` | `@openducktor/core` |
| ODT/public MCP tool schema validation | `ODT_TOOL_SCHEMAS` exported from `packages/contracts/src/odt-mcp-schemas.ts` and re-exported by `packages/openducktor-mcp/src/lib.ts` | `@openducktor/contracts`, consumed by MCP/host |
| Transition legality and backend-derived actions/workflows | `apps/desktop/src-tauri/crates/host-application/src/app_service/workflow_rules.rs` and `apps/desktop/src-tauri/crates/host-application/src/app_service/odt_mcp.rs` | Rust host application |
| Persisted task lifecycle state | Beads `status` field | Beads store accessed through `TaskStore` implementations |
| Repo attachment identity and shared Dolt runtime | Managed attachment root under the config dir plus shared Dolt server state under `beads/shared-server/` | `host-infra-system` + `host-infra-beads/src/lifecycle/*` |
| Agent-authored docs (spec/plan/qa) and session snapshots | Task metadata under configurable namespace (`openducktor` default) | `host-infra-beads` via host application |

## Replaceable Boundaries
- TS port: `AgentEnginePort` (`packages/core/src/ports/agent-engine.ts`)
- Rust trait: `TaskStore` (`apps/desktop/src-tauri/crates/host-domain/src/store.rs`)

Concrete adapters today:
- `AgentEnginePort` -> `OpencodeSdkAdapter` (`packages/adapters-opencode-sdk`)
- `TaskStore` -> `BeadsTaskStore` (`apps/desktop/src-tauri/crates/host-infra-beads`)

## Cross-Layer Change Checklist
1. If data shape changes, update `packages/contracts` first.
2. If `odt_*` tool shape or names change, update MCP schemas, core tool normalization/policy, adapter behavior, and UI assumptions together.
3. If public MCP tool shapes (`odt_create_task`, `odt_search_tasks`, `odt_read_task`, `odt_read_task_documents`) change, update package docs and public MCP schemas together.
4. If workflow transitions/actions change, update Rust `workflow_rules`, then docs and frontend rendering expectations.
5. Keep Tauri commands as transport/mapping layer; place policy in `AppService`/domain layers.
6. Preserve Beads as lifecycle source of truth; do not move lifecycle authority into UI-local state.
7. Keep Rust host and MCP transition policy matrices aligned; when one changes, update the other in the same change set.
8. Keep Beads attachment paths, Dolt coordinates, and metadata namespace ownership in the Rust host; do not reintroduce them into MCP startup or runtime-session contracts.

## Related Docs
- `docs/agent-orchestrator-module-map.md`
- `docs/beads-shared-dolt-lifecycle.md`
- `docs/runtime-integration-guide.md`
- `docs/task-workflow-status-model.md`
- `docs/task-workflow-actions.md`
- `docs/task-workflow-transition-matrix.md`
- `docs/mcp-runtime-security.md`
- `docs/desktop-csp-hardening.md`
