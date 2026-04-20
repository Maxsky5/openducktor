# Runs Removal Plan

## Decision

OpenDucktor will remove the `runs` concept instead of turning it into a persisted attempt model.

This change follows these rules:

- A task owns its implementation worktree.
- Sessions own agent identity and live runtime binding, not worktree ownership.
- Runtime routes and transport details remain ephemeral and are never persisted as durable task or session state.
- We must not replace `run` with `builder session` mechanically.
- Every current `run` usage must be classified as one of:
  - remove,
  - replace with task-owned worktree or task state,
  - replace with generic session state or generic session operation,
  - replace with runtime/liveness logic.

This plan intentionally avoids introducing a new persisted `attempt` model.

## Target Model

### Task-owned worktree

- Each task can have at most one implementation worktree for now.
- The worktree is a task concept, not a builder-session concept.
- The host must be able to answer task-scoped questions about the worktree even when no builder session exists.
- The task worktree may be created before or independently from Builder in the future.
- The worktree path should be resolved from task/workspace state and exposed as a task-scoped read model.

### Session model

- Sessions remain the durable identity for agent work.
- `spec`, `planner`, `build`, and `qa` sessions should be stopped through one generic session-stop path.
- Session state should not carry `runId` or any equivalent replacement.
- If Builder needs user replies, those replies should go through generic live-session interaction mechanisms rather than a Builder-only run API.

### Runtime/liveness model

- Runtime route ownership stays in the runtime layer.
- Runtime restart guards and live-session probing should reason about active live sessions, not active runs.
- Hydration should re-resolve live runtime attachment from durable session context and current runtime/session state, not from runs.

### Task workflow model

- Task status remains the source of truth for workflow transitions.
- Task cleanup/finalization should be expressed as task-scoped operations.
- Any behavior that was only a convenience mirror of task status should be removed instead of recreated under a new name.

## Current Reality That Drives The Migration

The current code already partially assumes the target model even though `runs` still exist.

- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_runtime_setup.rs`
  - Build worktree path is deterministic: `<worktreeBase>/<taskId>`.
  - Build start fails if that task-scoped path already exists.
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/approval_context_service.rs`
  - Approval logic talks about a builder worktree for a task, not a builder run.
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_reset_service.rs`
  - Reset logic already thinks in terms of task worktrees.
- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/session_stop.rs`
  - The code already has a generic `agent_session_stop` path covering multiple roles.

The inconsistency today is that a task-scoped worktree model coexists with a separate run model that leaks into host APIs, frontend state, and UI read models.

## Usage Review And Disposition

This section reviews all meaningful current production usages of `runs` and assigns the correct replacement.

### 1. Shared contracts and terminology

Files reviewed:

- `packages/contracts/src/run-schemas.ts`
- `apps/desktop/src-tauri/crates/host-domain/src/runtime/state.rs`
- `docs/runtime-integration-guide.md`
- `docs/architecture-overview.md`
- `docs/task-workflow-actions.md`
- `docs/task-workflow-transition-matrix.md`
- `docs/tanstack-query-cache-strategy.md`

Current usage:

- Defines `RunSummary`, `RunState`, run events, and `BuildContinuationTargetSource` values `active_build_run | builder_session`.
- Documents `build_start` as returning a `RunSummary` and task list loading as `tasks + runs`.

Disposition:

- Remove `RunSummary`, `RunState`, `runId`, and the `runs` list contract.
- Remove `BuildContinuationTargetSource`; the task worktree should not report whether it came from an active run or a session.
- Keep non-run runtime concepts that are still valid, but move them into contracts that are not named around runs.
- Introduce a task-scoped worktree or implementation-context contract instead.

Replacement owner:

- Task-owned worktree or task implementation context.

### 2. Host command and adapter surface

Files reviewed:

- `apps/desktop/src-tauri/src/commands/build.rs`
- `apps/desktop/src-tauri/src/headless/runtime_commands.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `packages/adapters-tauri-host/src/build-runtime-client.ts`
- `packages/adapters-tauri-host/src/index.ts`

Current usage:

- Exposes `runs_list`, `build_start`, `build_respond`, `build_stop`, and `build_cleanup`.
- Frontend host client surfaces `runsList`, `buildStart`, `buildRespond`, `buildStop`, `buildCleanup`, and also `agentSessionStop`.

Disposition:

- Remove `runs_list`.
- Remove `build_stop`; use generic `agent_session_stop` everywhere.
- Remove `build_respond`; replace with generic session interaction or reply APIs if Builder still needs them.
- Remove `build_cleanup`; replace with task-scoped implementation finalization or cleanup operations.
- Rework `build_start` so the task workflow action still exists, but the transport shape stops returning `RunSummary`.
- Replace the old continuation-target read with a task-scoped worktree or implementation-context read API.

Replacement owner:

- Task workflow API for task-scoped operations.
- Generic session API for session stop and live replies.

### 3. In-memory host run registry

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/service_core.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_lifecycle.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_cleanup.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/run_exposure.rs`

Current usage:

- `AppService` keeps an in-memory `runs` map.
- Builder startup creates `RunProcess` state and emits run-scoped events.
- Cleanup and run exposure depend on that in-memory registry.

Disposition:

- Remove the `runs` registry entirely.
- Move surviving responsibilities to the correct owners:
  - task worktree lifecycle,
  - generic session lifecycle,
  - runtime liveness probing.

Replacement owner:

- Task worktree service.
- Generic session orchestration.
- Runtime liveness layer.

### 4. Builder startup and worktree creation

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_runtime_setup.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_lifecycle.rs`

Current usage:

- Build start prepares a task-scoped worktree and immediately creates a run around it.

Disposition:

- Keep the task-scoped worktree preparation logic.
- Move it behind a task-owned worktree service or task implementation-context service.
- Decouple worktree creation from run creation.
- After the worktree exists, start or attach a generic build session without creating a separate run object.

Replacement owner:

- Task-owned worktree.
- Generic build session start path.

### 5. Stop, reply, and cleanup semantics

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/session_stop.rs`
- `apps/desktop/src/state/operations/tasks/use-delegation-operations.ts`

Current usage:

- `buildStop` and `buildCleanup` are run-targeted.
- `buildRespond` is run-targeted.
- The host already has a generic `agent_session_stop` path.

Disposition:

- Replace `buildStop` with generic session stop.
- Replace `buildRespond` with generic session interaction if the functionality is still needed.
- Replace `buildCleanup` with a task-scoped implementation-finalization operation.
- Remove all stop-time matching between sessions and runs.

Replacement owner:

- Session stop: generic session concept.
- Reply/message/approval handling: generic live-session concept.
- Cleanup/finalization: task concept.

### 6. Build continuation and QA entry

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/session_service.rs`
- `apps/desktop/src/state/queries/build-runtime.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/runtime/runtime.ts`

Current usage:

- Continuation target prefers active build run, then latest builder session worktree.
- QA runtime acquisition checks for a matching active run before falling back to `runtimeEnsure`.

Disposition:

- Remove the run-vs-session preference logic.
- Replace it with task-owned worktree resolution.
- QA should continue from the task implementation worktree when it exists.
- If no task worktree exists, the host should return a task-scoped actionable error.

Replacement owner:

- Task-owned worktree or task implementation context.

### 7. Task guards for delete, reset, and implementation reset

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_activity_guard/mod.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_activity_guard/probe_support.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_reset_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/implementation_reset_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/task_deletion_service.rs`

Current usage:

- Guards distinguish active runs from active sessions.
- Reset logic clears in-memory run state in addition to sessions, branches, worktrees, and task metadata.

Disposition:

- Drop the active-run dimension entirely.
- Guard destructive actions using:
  - active sessions,
  - task-owned worktree state,
  - runtime-liveness probing when necessary.
- Remove the reset step that clears run state.

Replacement owner:

- Active-session guard.
- Task-owned worktree cleanup.
- Runtime/liveness probing when needed.

### 8. Runtime protection and liveness checks

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/repo_health/mcp.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/run_exposure.rs`

Current usage:

- Runtime restart is skipped because an active run is using the runtime.
- `runs_list` exposes only visible runs after probing whether related live runtime sessions still exist.

Disposition:

- Remove `runs_list` entirely.
- Replace runtime protection logic with a direct check for live sessions using the runtime route and working directory.
- Keep liveness probing, but make it session-centric instead of run-centric.

Replacement owner:

- Runtime/liveness concept.

### 9. Approval, branch, merge, and PR context

Files reviewed:

- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/builder_branch_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/approval_context_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/direct_merge_workflow_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/pull_request_workflow_service.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/task_workflow/pull_request_provider_service.rs`

Current usage:

- Cleanup and approval logic prefer active build runs when present.
- Approval context asks for a builder worktree but still reaches it through run/session-derived logic.

Disposition:

- Make these services depend on task-owned worktree resolution only.
- Remove any preference for active runs.
- Keep the existing business wording: approval requires a builder worktree for the task.

Replacement owner:

- Task-owned worktree.

### 10. Frontend task queries and shared state

Files reviewed:

- `apps/desktop/src/state/queries/tasks.ts`
- `apps/desktop/src/state/operations/tasks/use-task-operations.ts`
- `apps/desktop/src/state/providers/tasks-state-provider.tsx`
- `apps/desktop/src/state/providers/agent-studio-state-provider.tsx`
- `apps/desktop/src/types/state-slices.ts`

Current usage:

- Startup and refresh load `tasks + runs`.
- Shared app state exposes `runs` broadly.

Disposition:

- Remove `runs` queries, cache keys, invalidations, and shared state.
- Replace any surviving read need with:
  - task worktree read data,
  - active session summaries,
  - task status.

Replacement owner:

- Task read models.
- Session read models.

### 11. Frontend lifecycle events and run completion signal

Files reviewed:

- `apps/desktop/src/state/lifecycle/use-app-lifecycle.ts`
- `apps/desktop/src/state/providers/delegation-state-provider.tsx`
- `apps/desktop/src/pages/agents/use-agents-page-readiness.ts`
- `apps/desktop/src/state/app-state-contexts.ts`

Current usage:

- The app subscribes to run events.
- It stores `runCompletionSignal` keyed by `runId`.
- Agent Studio readiness uses that signal to bump recovery state.

Disposition:

- Remove `runCompletionSignal` first rather than renaming it.
- Let task refresh and session refresh drive recovery.
- Only reintroduce a dedicated signal if a concrete regression remains after removing runs.

Replacement owner:

- Pure removal for now.
- Fallback owner, only if needed later: generic session-lifecycle signal.

### 12. Frontend orchestration and hydration

Files reviewed:

- `apps/desktop/src/state/operations/agent-orchestrator/runtime/runtime.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/repo-session-hydration-service.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/session-hydration-operations.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/hydration-runtime-resolution.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/load-sessions-stages.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/ensure-ready.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/support/session-runtime-attachment.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/support/persistence.ts`
- `apps/desktop/src/types/agent-orchestrator.ts`
- `apps/desktop/src/state/agent-sessions-store.ts`

Current usage:

- Build and QA runtime resolution still depend on `runsRef` and `runId`.
- Hydration services preload runs and attach `runId` to session state.
- Persisted sessions intentionally drop run state, but the in-memory session model still carries it.

Disposition:

- Remove `runId` from in-memory session state.
- Replace build and QA worktree resolution with task-owned worktree reads.
- Hydration should reattach through generic session and runtime information only.
- Do not add a session-scoped replacement for run identity.

Replacement owner:

- Task-owned worktree.
- Generic session and runtime attachment.

### 13. Frontend worktree resolution and right-panel behavior

Files reviewed:

- `apps/desktop/src/features/agent-studio-git/use-agent-studio-worktree-resolution.ts`
- `apps/desktop/src/pages/agents/right-panel/use-agents-page-right-panel-model.ts`
- `apps/desktop/src/features/agent-studio-build-tools/use-agent-studio-build-tools-bootstrap.ts`

Current usage:

- Diff and worktree resolution fall back to `sessionRunId` and `runsList`.
- Right-panel logic uses session `runId` to locate the current worktree.

Disposition:

- Replace these with task-owned worktree resolution.
- The active session can influence whether the UI is live, but not where the task worktree is.

Replacement owner:

- Task-owned worktree.

### 14. Kanban and task-detail read models

Files reviewed:

- `apps/desktop/src/pages/kanban/use-kanban-board-model.ts`
- `apps/desktop/src/components/features/kanban/kanban-column.tsx`
- `apps/desktop/src/components/features/kanban/kanban-task-badges.tsx`
- `apps/desktop/src/lib/task-display.ts`
- `apps/desktop/src/components/features/task-details/task-details-sheet.tsx`

Current usage:

- Kanban derives `runStateByTaskId`.
- PR detection allows an active builder run to enable the action.
- Task detail UI consumes runs directly.

Disposition:

- Remove `runStateByTaskId`.
- Re-derive UI state from:
  - task status,
  - active session summaries,
  - task-owned worktree presence,
  - existing waiting-input presentation state.
- Recheck whether PR detection truly needs any live-state shortcut; if task status and task worktree are enough, simplify to those.

Replacement owner:

- Task state.
- Active session summaries.
- Task-owned worktree.

## Cross-Cutting Migration Rules

These rules apply to every code change in the migration.

1. Do not introduce a session-owned replacement for task worktree.
2. Do not keep a hidden ephemeral `runId` under a different name.
3. Do not persist live runtime route or connection details.
4. Do not recreate `runCompletionSignal` unless concrete breakage proves it is needed.
5. Prefer task-scoped workflow and worktree reads over rebuilding another global operational cache.
6. Keep the backend as the authority for task workflow actions and task worktree availability.

## Proposed New Read And Write Surfaces

Exact names can be refined during implementation, but the plan needs these capability shapes.

### Task worktree read surface

Needed behavior:

- resolve whether a task currently has an implementation worktree,
- return its working directory when it exists,
- return actionable missing-worktree errors,
- optionally expose derived branch and dirty-state information if already needed by approval and PR flows.

Possible host surface:

- `task_worktree_get(repoPath, taskId)`
- or a richer `task_implementation_context_get(repoPath, taskId)`

### Task worktree ensure surface

Needed behavior:

- create the task worktree when missing,
- fail if unsafe,
- be usable independently from Builder session start.

Possible host surface:

- `task_worktree_ensure(repoPath, taskId)`

### Generic session stop surface

Needed behavior:

- stop any active session by durable session target,
- resolve runtime route dynamically,
- work for `spec`, `planner`, `build`, and `qa`.

Existing surface to standardize on:

- `agent_session_stop`

### Generic session interaction surface

Needed behavior:

- send user replies or approvals to the active session when Builder currently uses `buildRespond`.

Possible direction:

- reuse the same generic session interaction path already used by non-builder sessions,
- or introduce a generic session reply API if one is missing.

### Task-scoped implementation finalization surface

Needed behavior:

- close or clean up the implementation attempt for a task,
- transition task workflow state,
- clean task-owned worktree when appropriate.

Possible direction:

- task-scoped workflow commands rather than a run-scoped cleanup API.

## Implementation Phases

### Phase 1 - Introduce task-owned worktree read model

Goals:

- Add a host-owned task worktree resolution surface.
- Keep current behavior stable while new consumers are migrated.

Changes:

- Add a task worktree summary or task implementation-context contract in `packages/contracts`.
- Mirror it in `apps/desktop/src-tauri/crates/host-domain`.
- Implement task worktree resolution in host application code using current deterministic path logic and filesystem checks.
- Update docs to describe worktree as task-owned.

Exit criteria:

- Approval and continuation services can read task worktree data without asking for runs.

### Phase 2 - Move host business rules off runs

Goals:

- Make host workflow rules depend on task worktree, sessions, and runtime liveness only.

Changes:

- `session_service.rs`: resolve continuation from task worktree only.
- `builder_branch_service.rs`: remove active-run preference.
- `approval_context_service.rs`: source working directory from task worktree service.
- `task_activity_guard/*`: remove run evidence and run-only probes.
- `repo_health/mcp.rs`: guard runtime restart using live-session usage instead of runs.

Exit criteria:

- No host business rule distinguishes active run vs active session.

### Phase 3 - Collapse frontend run reads and run-based orchestration

Goals:

- Remove runs from frontend startup, hydration, and UI state.

Changes:

- `queries/tasks.ts`: drop `runs` query key and bundle.
- `use-task-operations.ts` and providers: remove `runs` from shared state.
- `runtime.ts`: replace `runsRef` logic with task worktree and generic session logic.
- hydration and session state files: remove `runId` and all run attachment logic.
- `use-agent-studio-worktree-resolution.ts`: resolve from task worktree.
- Kanban and task-detail read models: remove `runStateByTaskId`.

Exit criteria:

- Frontend no longer fetches or stores runs.

### Phase 4 - Collapse run-targeted command surfaces

Goals:

- Remove run-targeted transport APIs and standardize on task or session operations.

Changes:

- Remove `runs_list`, `build_stop`, `build_respond`, and `build_cleanup` commands.
- Update `packages/adapters-tauri-host` to expose only the new task/session surfaces.
- Update `use-delegation-operations.ts` and any other callers.

Exit criteria:

- No production TypeScript or Rust API takes `runId`.

### Phase 5 - Delete the host run registry and leftover run contracts

Goals:

- Remove the old model completely.

Changes:

- Delete in-memory run registry from `service_core.rs` and related host modules.
- Remove `RunSummary`, `RunState`, and run event contracts.
- Remove run-only docs and rename any remaining runtime-only documentation that still points at run types.

Exit criteria:

- No production code references `RunSummary`, `RunState`, `runId`, `runsList`, or `runCompletionSignal`.

## Risk Areas

### Builder replies and approval flow

Risk:

- `buildRespond` currently models user replies in a build-specific way.

Mitigation:

- Before deleting it, identify the generic live-session reply path Builder should use.
- If generic reply support is incomplete, build that support first instead of preserving a hidden builder-only path.

### QA continuation

Risk:

- QA currently relies on build continuation target lookup and sometimes on active run reuse.

Mitigation:

- Move QA continuation to task worktree resolution first, then remove run reuse logic.

### UI states that currently mirror run states

Risk:

- Kanban badges and readiness flows may depend on special run states such as `blocked` or `awaiting_done_confirmation`.

Mitigation:

- Re-check whether these states are true business requirements.
- If they are not needed once task status and session waiting-input state are correct, drop them.
- If a true requirement remains, express it through task or generic session state, not a run model.

### Runtime restart guard

Risk:

- The current restart guard uses active runs to avoid interrupting live build work.

Mitigation:

- Replace it with direct live-session route/workdir usage checks before deleting the old path.

## Test Strategy

### Focused host verification first

- `bun run test:rust`
- targeted host-application integration tests around:
  - session stop,
  - approval context,
  - workflow guards,
  - runtime checks,
  - task reset and implementation reset.

### Frontend verification second

- `bun run --filter @openducktor/desktop test`
- targeted tests around:
  - Agent Studio worktree resolution,
  - session start flow,
  - task queries,
  - Kanban model,
  - task details.

### Full verification before merge

- `bun run typecheck`
- `bun run lint`
- `bun run test`
- `bun run build`

## Done Criteria

- No production code fetches or stores `runs`.
- No production API takes or returns `runId`.
- Task worktree is exposed and consumed as a task-owned concept.
- Stopping a session is always generic session stop.
- Build cleanup/finalization is task-scoped, not run-scoped.
- QA continuation resolves from task worktree, not active-run preference.
- UI no longer depends on `runCompletionSignal` or `runStateByTaskId`.
- Docs describe task-owned worktree and generic sessions without reintroducing a hidden run model.
