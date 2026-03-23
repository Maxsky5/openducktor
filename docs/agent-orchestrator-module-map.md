# Agent Orchestrator Module Map (Desktop)

This document is the maintainer-facing map for `apps/desktop/src/state/operations/agent-orchestrator`.

It captures:
- module ownership after the session/runtime refactor,
- invariants that must remain true,
- the remaining architecture pressure points worth addressing next.

## Public Boundary

`apps/desktop/src/state/operations/agent-orchestrator/index.ts`

- Keeps the public surface narrow for callers outside the folder.
- `use-agent-orchestrator-operations.ts` is the UI-facing entrypoint.
- Public operations are intentionally split by concern:
  - session lifecycle actions (`start`, `fork`, `send`, `stop`, permission/question replies)
  - explicit hydration operations (`bootstrapTaskSessions`, `hydrateRequestedTaskSessionHistory`, `reconcileLiveTaskSessions`)
  - runtime/session read helpers used by active-session UI (`readSessionModelCatalog`, `readSessionTodos`)

## Ownership Model

The current design uses three distinct owners. Regressions usually happen when these boundaries blur.

### 1. Repo hydration owner

Files:
- `lifecycle/repo-session-hydration-service.ts`
- `lifecycle/session-hydration-operations.ts`
- `lifecycle/load-sessions.ts`
- `lifecycle/reattach-live-session.ts`
- `lifecycle/live-agent-session-cache.ts`
- `lifecycle/hydration-runtime-resolution.ts`

Owns:
- bootstrapping persisted sessions into in-memory state
- reconciling live agent sessions for the active repo
- repo-scoped dedupe and retry boundaries
- grouping live agent session scans by runtime endpoint + working directory
- reattaching live sessions and projecting runtime status back into session state

Must not own:
- selected-session UI data such as model catalog, todos, or repeated diff refreshes
- page-level view concerns

### 2. Event-stream owner

Files:
- `events/session-events.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-tool-parts.ts`
- `events/session-helpers.ts`
- adapter-side transport: `packages/adapters-opencode-sdk/src/event-stream.ts`

Owns:
- one runtime event transport per OpenCode runtime endpoint
- fanout from runtime events to the relevant local session
- transcript assembly, permission/question event application, and terminal state transitions

Must not own:
- request/response caching
- repo hydration orchestration

### 3. Active-session read owner

Files outside the orchestrator folder, but critical to the boundary:
- `apps/desktop/src/pages/agents/use-agent-studio-active-session-runtime-data.ts`
- `apps/desktop/src/state/queries/agent-session-runtime.ts`
- `apps/desktop/src/features/agent-studio-git/use-agent-studio-diff-data.ts`
- `apps/desktop/src/pages/agents/right-panel/use-agent-studio-dev-server-panel.ts`

Owns:
- request/response reads for the currently viewed session
- TanStack Query caching for model catalog, todos, repo config, task docs, and other stable host reads
- build-tools panel reads such as git diff state and dev-server state

Must not own:
- session existence
- runtime liveness detection
- background session hydration

## Module Responsibilities

### `handlers/`

`handlers/session-actions.ts`

- Owns user-driven actions after a session exists.
- Keeps stop semantics deterministic locally even when remote stop fails.
- Persists only durable checkpoints, not transient runtime churn.

`handlers/start-session.ts`

- Owns session start and reuse policy.
- Enforces scenario-driven start-mode rules.
- Supports all three start modes:
  - `fresh`
  - `reuse`
  - `fork`
- Uses stale-repo guards across async boundaries.
- Rolls back newly created remote sessions when the repo context becomes stale.
- Builder PR generation now goes through this same path using scenario `build_pull_request_generation`, which is `fork`-only.

`handlers/public-operations.ts`

- Exposes explicit app-facing operations instead of a generic “load everything” entrypoint.
- Keeps call sites honest about intent: bootstrap, selected-session history hydration, reconcile.

### `lifecycle/`

`lifecycle/repo-session-hydration-service.ts`

- Repo-scoped coordinator for bootstrap/reconcile scheduling.
- Prevents React rerenders from starting duplicate hydration waves.

`lifecycle/session-hydration-operations.ts`

- Defines the explicit hydration use cases:
  - bootstrap persisted task sessions
  - hydrate one requested session history
  - reconcile live task sessions

`lifecycle/load-sessions.ts`

- Implements hydration mechanics:
  - persisted record merge
  - requested history load
  - runtime pending-input load
  - runtime route reuse when a live session is already attached

`lifecycle/reattach-live-session.ts`

- Canonical live-session reattach path.
- If a runtime reports a persisted session live, this is the only place that should resume/attach it.

`lifecycle/live-agent-session-cache.ts`

- Owns endpoint + directory grouping for live agent session scans.
- This is infrastructure-level sharing, not UI-level dedupe.

`lifecycle/hydration-runtime-resolution.ts`

- Resolves runtime connection from persisted session context, active runs, and runtime instances.
- Must fail fast instead of silently falling back to the wrong runtime kind or working directory.

### `events/`

`events/session-events.ts`

- Single-session event dispatcher.
- Delegates status, part, tool, permission, and question handling to focused helpers.

`events/session-lifecycle.ts`

- Owns lifecycle transitions and pending permission/question state changes caused by runtime events.

`events/session-tool-parts.ts`

- Owns tool-row lifecycle updates.
- Must not trigger duplicate completion side effects.

### `hooks/`

`hooks/use-orchestrator-session-state.ts`

- In-memory store + refs bridge for orchestrator-owned session state.
- Still central, but now thinner because repo hydration, event transport, and active-session reads have clearer owners.

### `support/`

- `core.ts`: stale-repo guards and shared invariants.
- `persistence.ts`: persisted record mapping and history-to-chat conversion.
- `session-prompt.ts`: prompt construction and requested-session prompt context loading.
- `models.ts`, `messages.ts`, `assistant-meta.ts`, `tool-messages.ts`, `question-messages.ts`: transcript/message normalization helpers.

## Critical Invariants

These invariants must hold after any change:

1. Repo hydration is explicit
- bootstrap, reconcile, and requested-history hydration must remain separate intents
- avoid reintroducing one generic “loader” path with ad hoc flags

2. Session start policy is scenario-owned
- callers choose a scenario
- allowed start modes come from `packages/contracts/src/agent-workflow-schemas.ts`
- UI resolves the actual mode and source session when needed
- page code must not hardcode builder follow-up or PR-generation behavior outside the scenario registry

3. Live runtime state wins over persisted hints
- for live resumed sessions, runtime status + runtime pending input are authoritative
- persisted pending permissions/questions are recovery data, not the primary live source of truth

4. Event transport is shared at runtime boundary
- OpenCode uses one `/global/event` stream per runtime endpoint
- do not reintroduce per-session or per-worktree event streams at the desktop layer

5. Active-session reads stay query-owned
- model catalog, todos, repo config, task docs, diff state, and dev-server state should remain request/response reads owned by TanStack Query or a dedicated read-model hook
- they must not move back into repo hydration or stream handlers

6. Read-only role permission policy remains strict
- `spec`, `planner`, and `qa` must continue auto-rejecting mutating permission requests
- failures must remain visible/actionable, not silently ignored

7. Stale repo guards remain fail-fast
- session start/resume/hydration must not leak sessions across repo switches

## Regression Test Anchors

Use these as the first-line safety net:

- `use-agent-orchestrator-operations.test.tsx`
  - repo hydration scheduling
  - reconcile dedupe
  - repo-switch resume behavior

- `lifecycle/load-sessions.test.ts`
  - requested history hydration
  - runtime pending-input hydration
  - runtime-route reuse for already-attached live sessions

- `lifecycle/repo-session-hydration-service.test.ts`
  - repo-scoped hydration coordinator behavior

- `events/session-events.test.ts`
  - event application matrix
  - permission/question handling

- `packages/adapters-opencode-sdk/src/index.test.ts`
  - one global event stream per runtime endpoint

- `apps/desktop/src/features/agent-studio-git/use-agent-studio-diff-data.test.tsx`
  - build-tools diff read model behavior
  - visibility-driven refresh instead of timer polling

- `apps/desktop/src/pages/agents/right-panel/use-agent-studio-dev-server-panel.hook.test.tsx`
  - dev-server query/subscription behavior

## Architecture Pressure Points

The refactor improved the system materially, but a few design choices are still carrying too much weight.

### 1. Live session classification still spans too many layers

Today, “is this session really running, waiting for input, or stale?” is still assembled from:
- live agent session status,
- runtime pending-input lists,
- persisted session metadata,
- transcript history reconstruction.

This works, but the boundary is still too distributed.

Recommended next step:
- add one authoritative `AgentEnginePort` read for a live session snapshot
- return status + pending permissions + pending questions together
- make desktop hydration consume that single live snapshot for resumed sessions

That would remove another class of stale-session bugs by design.

### 2. Build-tools right panel still owns too much bootstrap work

The right panel is much better now, but initial selected-session hydration still does a burst of:
- git worktree status reads,
- dev-server state read,
- session history/todos/catalog reads.

These reads are now bounded, not looping, but the initial bootstrap is still heavier than it should be.

Recommended next step:
- extract a dedicated build-tools read model in `state/`
- let the right panel compose data instead of initiating its own bootstrap sequence
- collapse the initial git diff bootstrap toward one authoritative worktree snapshot load

### 3. Documents remain eager for the selected task

Agent Studio still loads task docs eagerly for the selected task context.

That is reasonable today, but if the page continues to grow, document loading may be worth splitting into:
- active transcript/session data
- active task document data

with clearer UI-level ownership.

## Safe Change Checklist

Before merging changes in this folder:

1. Keep bootstrap/reconcile/requested-history intent boundaries explicit.
2. Do not reintroduce interval-based background polling for build-tools diff reads.
3. Do not reintroduce repo-root model catalog reads while an active session owns its runtime catalog.
4. Keep `/global/event` as the only OpenCode event transport entrypoint.
5. Preserve fail-fast runtime routing; never fall back to the wrong runtime kind or working directory.
6. Run:
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test`
