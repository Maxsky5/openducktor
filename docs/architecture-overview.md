# End-to-End Architecture and Data Flow

## Purpose
This document is the maintainer-facing map of how OpenDucktor moves data across layers, from React UI to Beads/MCP.

Use it to answer:
- which layer owns a rule,
- where to change code safely,
- what runtime path a user action follows.

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
| Infrastructure/persistence (Rust) | `apps/desktop/src-tauri/crates/host-infra-beads/*`, `apps/desktop/src-tauri/crates/host-infra-system/*` | Beads-backed `TaskStore`, config/worktree/process integrations | UI workflow decisions |
| MCP workflow service (TS) | `packages/openducktor-mcp/src/index.ts`, `packages/openducktor-mcp/src/lib.ts`, `packages/openducktor-mcp/src/odt-task-store.ts` | `odt_*` tool execution and validation against Beads metadata/status | Frontend rendering/state |

## Runtime Data Flows

### 1) List tasks for Kanban
1. `useTaskOperations.refreshTasks` (frontend) validates repo readiness and calls `refreshTaskData`.
2. `refreshTaskData` requests `host.tasksList(repoPath)` and `host.runsList(repoPath)` in parallel.
3. `host` is `TauriHostClient` (`apps/desktop/src/lib/host-client.ts`), which invokes Tauri commands through `@tauri-apps/api/core`.
4. `packages/adapters-tauri-host/src/task-client.ts` maps `tasksList` to `tasks_list`.
5. `apps/desktop/src-tauri/src/commands/tasks.rs::tasks_list` calls `AppService::tasks_list`.
6. `AppService::tasks_list` ensures repo init, calls `TaskStore::list_tasks`, then enriches each task with backend-derived `available_actions` and `agent_workflows`.
7. `BeadsTaskStore` (`host-infra-beads`) reads from Beads via `bd`, parses metadata, and returns `TaskCard` data.
8. Frontend receives typed payloads (Zod-validated in adapter), stores them in state, and renders columns/actions.

Key boundary:
- UI must render actions from backend `availableActions`; it must not infer transition authority from status heuristics.

### 2) Start an agent session
1. Agent Studio triggers `startAgentSession` in `use-agent-orchestrator-operations.ts`.
2. `start-session.ts` enforces in-flight dedupe and reuse policy (in-memory latest, then persisted metadata session, else new).
3. For new sessions it concurrently loads task docs, resolves runtime, and loads repo default model.
4. Runtime acquisition:
- `build` role: `host.buildStart` creates worktree + OpenCode runtime.
- `qa` role: `host.opencodeRuntimeStart(repo, task, "qa")` creates role/task runtime.
- `spec`/`planner`: `host.opencodeRepoRuntimeEnsure(repo)` ensures shared workspace runtime.
5. Rust host spawns OpenCode with `OPENCODE_CONFIG_CONTENT` containing MCP server `openducktor` and env (`ODT_REPO_PATH`, `ODT_BEADS_DIR`, `ODT_METADATA_NAMESPACE`).
6. `OpencodeSdkAdapter` (`AgentEnginePort` implementation) starts/resumes session and subscribes to OpenCode stream events.
7. On prompt send, adapter applies role-scoped tool gating from `AGENT_ROLE_TOOL_POLICY` (core) and runtime tool IDs, then sends `tools` selection to OpenCode.
8. Session snapshots are persisted via `host.agentSessionUpsert` into task metadata for restart/reuse continuity.

Critical session invariants:
- Read-only roles (`spec`, `planner`, `qa`) must auto-reject mutating permission prompts; on auto-reply failure, permission remains actionable and a system error is emitted.
- Stale workspace protection must roll back newly started/resumed sessions with best-effort `stopSession` cleanup.

### 3) Workflow transition
OpenDucktor has two transition paths that converge on Beads as persistent truth.

Human-triggered path:
1. User clicks a workflow action surfaced from `availableActions`.
2. Frontend operation calls host method (`taskTransition`, `humanApprove`, `buildCompleted`, etc.).
3. Adapter invokes a Tauri command (for example `task_transition`, `human_approve`, `build_completed`).
4. Rust command delegates to `AppService`, which validates transition via `workflow_rules.rs`.
5. `TaskStore` updates Beads status/metadata.
6. Frontend refreshes tasks and re-renders with backend-derived action set.

Agent-triggered path:
1. Active OpenCode session calls `odt_*` tool through local MCP server `openducktor`.
2. `packages/openducktor-mcp` validates input against `ODT_TOOL_SCHEMAS`.
3. `OdtTaskStore` mutates Beads metadata/status and applies transition rules.
4. Tool result is emitted in session stream.
5. Frontend session-event handler detects completed ODT mutation tools and triggers task refresh.

## Source-of-Truth Contracts and Ownership
| Concern | Source of truth | Owner modules |
|---|---|---|
| Task statuses, issue types, action IDs | `packages/contracts/src/task-schemas.ts` | `@openducktor/contracts`, consumed by adapters/frontend/host |
| Role, scenario, ODT tool IDs | `packages/contracts/src/agent-workflow-schemas.ts` | `@openducktor/contracts` |
| Role-to-tool allowlist | `AGENT_ROLE_TOOL_POLICY` in `packages/core/src/types/agent-orchestrator.ts` | `@openducktor/core` |
| ODT tool schema validation | `ODT_TOOL_SCHEMAS` exported from `packages/openducktor-mcp/src/lib.ts` (defined in `src/tool-schemas.ts`) | `@openducktor/openducktor-mcp` |
| Transition legality and backend-derived actions/workflows | Rust host path: `apps/desktop/src-tauri/crates/host-application/src/app_service/workflow_rules.rs`; MCP path: `packages/openducktor-mcp/src/workflow-policy.ts` + `packages/openducktor-mcp/src/task-transitions.ts` | Rust host application + MCP workflow service |
| Persisted task lifecycle state | Beads `status` field | Beads store accessed through `TaskStore` implementations |
| Agent-authored docs (spec/plan/qa) and session snapshots | Task metadata under configurable namespace (`openducktor` default) | `host-infra-beads` + `openducktor-mcp` |

## Replaceable Boundaries
- TS port: `AgentEnginePort` (`packages/core/src/ports/agent-engine.ts`)
- Rust trait: `TaskStore` (`apps/desktop/src-tauri/crates/host-domain/src/store.rs`)

Concrete adapters today:
- `AgentEnginePort` -> `OpencodeSdkAdapter` (`packages/adapters-opencode-sdk`)
- `TaskStore` -> `BeadsTaskStore` (`apps/desktop/src-tauri/crates/host-infra-beads`)

## Cross-Layer Change Checklist
1. If data shape changes, update `packages/contracts` first.
2. If `odt_*` tool shape or names change, update MCP schemas, core tool normalization/policy, adapter behavior, and UI assumptions together.
3. If workflow transitions/actions change, update Rust `workflow_rules`, then docs and frontend rendering expectations.
4. Keep Tauri commands as transport/mapping layer; place policy in `AppService`/domain layers.
5. Preserve Beads as lifecycle source of truth; do not move lifecycle authority into UI-local state.
6. Keep Rust host and MCP transition policy matrices aligned; when one changes, update the other in the same change set.

## Related Docs
- `docs/agent-orchestrator-module-map.md`
- `docs/task-workflow-status-model.md`
- `docs/task-workflow-actions.md`
- `docs/task-workflow-transition-matrix.md`
- `docs/mcp-runtime-security.md`
