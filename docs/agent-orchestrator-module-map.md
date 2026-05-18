# Agent Orchestrator Module Map

This document is the maintainer-facing map for `packages/frontend/src/state/operations/agent-orchestrator`.

It captures:
- module ownership after the session/runtime refactor,
- invariants that must remain true,
- the remaining architecture pressure points worth addressing next.

## Public Boundary

`packages/frontend/src/state/operations/agent-orchestrator/index.ts`

- Keeps the module re-export surface narrow for callers outside the folder.
- `use-agent-orchestrator-operations.ts` is the UI-facing composition entrypoint.
- `handlers/public-operations.ts` creates the app-state operation surface exposed to pages.
- Public operations are intentionally split by concern:
  - session lifecycle actions (`start`, `fork`, `send`, `stop`, permission/question replies)
  - explicit hydration/readiness operations (`bootstrapTaskSessions`, `hydrateRequestedTaskSessionHistory`, `ensureSessionReadyForView`, `reconcileLiveTaskSessions`)
  - runtime transcript attachment and session removal
  - runtime-scoped read delegates used by active-session UI (`readSessionModelCatalog`, `readSessionTodos`, `readSessionHistory`, `readSessionSlashCommands`, `readSessionFileSearch`)
  - local session controls such as model updates and settling an initially-starting session

Stable request/response reads remain query-owned at their call sites even when the orchestrator context exposes the read delegate.

## Ownership Model

The current design uses three distinct owners. Regressions usually happen when these boundaries blur.

### 1. Repo hydration owner

Files:
- `lifecycle/repo-session-hydration-service.ts`
- `lifecycle/session-hydration-operations.ts`
- `lifecycle/load-sessions.ts`
- `lifecycle/load-sessions-stages.ts`
- `lifecycle/reattach-live-session.ts`
- `lifecycle/session-presence-cache.ts`
- `lifecycle/session-presence-source.ts`
- `lifecycle/session-presence-store.ts`
- `lifecycle/repo-session-presence-preloads.ts`
- `lifecycle/hydration-runtime-resolution.ts`
- `lifecycle/session-view-lifecycle.ts`
- `lifecycle/ensure-ready.ts`

Owns:
- persisted-record merge into in-memory state
- reconciling live agent sessions for the active repo/task
- requested-history hydration and runtime attachment recovery
- presence preload/store/cache ordering before adapter reads
- repo-scoped dedupe and retry boundaries
- grouping live session presence scans by repo path, runtime kind, and normalized working directory
- reattaching live sessions and projecting runtime status back into session state
- fail-fast runtime routing from persisted runtime metadata and working directory

Must not own:
- selected-session UI data such as model catalog, todos, or repeated diff refreshes
- page-level view concerns

### 2. Event-stream owner

Files:
- `events/session-events.ts`
- `events/session-event-types.ts`
- `events/session-event-batching.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-tool-parts.ts`
- `events/session-helpers.ts`
- adapter-side transports:
  - `packages/adapters-opencode-sdk/src/event-stream/`
  - `packages/adapters-codex-app-server/src/codex-app-server-adapter.ts`
  - `packages/adapters-codex-app-server/src/codex-event-mapper-pipeline.ts`
  - `packages/adapters-codex-app-server/src/event-mappers/*`
  - `packages/adapters-codex-app-server/src/codex-canonical-projector.ts`

Owns:
- frontend event batching and single-session dispatch
- OpenCode event attachment through one `/global/event` stream per runtime endpoint
- Codex app-server event attachment through one runtime-id subscription, with adapter-owned buffering, request routing, canonical mapping, and projection to `AgentEvent`
- fanout from runtime events to the relevant local session
- transcript assembly, terminal state transitions, and tool-row updates
- UI pending permission/question state plus read-only auto-reject policy application
- OpenCode queued/read transcript state, including same-id user-row updates
- Codex active-turn steering queues and duplicate echo suppression

Must not own:
- request/response caching
- repo hydration orchestration

### 3. Active-session read owner

Files outside the orchestrator folder, but critical to the boundary:
- `packages/frontend/src/pages/agents/use-agent-studio-active-session-runtime-data.ts`
- `packages/frontend/src/state/queries/agent-session-runtime.ts`
- `packages/frontend/src/pages/agents/chat-composer/use-agent-studio-chat-composer.ts`
- `packages/frontend/src/features/agent-chat-composer/prompt-input/*`
- `packages/frontend/src/components/features/agents/agent-chat/use-readonly-session-transcript-surface-model.ts`
- `packages/frontend/src/pages/agents/use-agent-studio-documents.ts`
- `packages/frontend/src/components/features/task-details/use-task-documents.ts`
- `packages/frontend/src/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.ts`
- `packages/frontend/src/features/agent-studio-git/use-agent-studio-diff-data.ts`
- `packages/frontend/src/pages/agents/right-panel/use-agent-studio-dev-server-panel.ts`

Owns:
- request/response reads for the currently viewed session
- TanStack Query keys for model catalog, todos, history, slash commands, file search, repo config, task docs, dev-server state, and other stable host reads
- build-tools panel snapshots such as task worktree, git diff state, and dev-server state
- diff controller/read-model behavior backed by `state/queries/git.ts` fetches
- selected task document application after workflow mutations; the event stream may request task-data refresh, but page/document hooks own fresh document loading and optimistic document previews

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
- Busy queued follow-up sends must preserve the active assistant/reasoning draft state and turn timing instead of resetting the current turn.

`handlers/start-session.ts`

- Executes an already-selected start mode. Launch-action allowed modes are resolved and validated by `packages/frontend/src/features/session-start` and `packages/frontend/src/lib/session-launch-actions.ts`.
- Supports all three start modes:
  - `fresh`
  - `reuse`
  - `fork`
- Uses stale-repo guards across async boundaries.
- Delegates mode-specific behavior to:
  - `start-session-fresh-strategy.ts`
  - `start-session-reuse-strategy.ts`
  - `start-session-fork-strategy.ts`
  - `start-session-runtime.ts`
  - `start-session-persistence.ts`
  - `start-session-local-state.ts`
  - `start-session-rollback.ts`
- Fresh starts require a selected-model runtime kind, resolve the target working directory first, then ensure/start the runtime.
- Fresh build starts without a target call `buildStart`; build starts with an existing target use shared `runtimeEnsure`.
- Fresh QA starts require an existing or provided build target, then use shared `runtimeEnsure`.
- Reuse validates/hydrates the chosen source session instead of acquiring a new runtime.
- Fork uses the source session runtime kind, working directory, and optional runtime id instead of calling `ensureRuntime`.
- Rolls back newly created remote sessions when the repo context becomes stale, persistence fails, or fork-history initialization fails before local registration.
- Builder PR generation goes through `features/session-start -> startSessionWorkflow -> startAgentSession` using launch action `build_pull_request_generation`, which supports `reuse` and `fork` from an existing Builder session.

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

- Composition entrypoint for session loading intents.
- Owns stale-guard setup, requested-history dedupe, and stage ordering.

`lifecycle/load-sessions-stages.ts`

- Implements the typed hydration stages used by `load-sessions.ts`:
  - persisted record merge
  - runtime resolution planning
  - prompt/prelude assembly
  - live reconciliation
  - requested-history hydration

`lifecycle/reattach-live-session.ts`

- Canonical live-session reattach path.
- If a runtime reports a persisted session live, this is the only place that should resume/attach it.

`lifecycle/session-presence-cache.ts`

- Owns repo/runtime-kind + directory grouping for session presence scans.
- This is infrastructure-level sharing, not UI-level dedupe.

`lifecycle/session-presence-source.ts`

- Defines presence read precedence: fresh store entry, preloaded authoritative scan, runtime-kind/directory scan cache, then direct adapter presence read when available.
- Treats authoritative scan misses as stale presence instead of probing again.

`lifecycle/session-presence-store.ts`

- Keeps short-lived repo presence snapshots shared across hydration/recovery calls.
- Must stay bounded by repo, runtime kind, working directory, and age.

`lifecycle/repo-session-presence-preloads.ts`

- Preloads runtime presence by repo/runtime kind/directory before task-session hydration waves.
- Prevents repeated adapter scans when many persisted sessions share the same runtime and working directory.

`lifecycle/hydration-runtime-resolution.ts`

- Resolves a `RepoRuntimeRef` from persisted runtime kind plus normalized working directory.
- Must fail fast on missing runtime kind or missing working directory instead of silently falling back to the repo default runtime.

`lifecycle/session-view-lifecycle.ts` and `lifecycle/ensure-ready.ts`

- Gate selected-session readiness before page reads or sends use the session.
- Coordinate runtime attachment recovery without moving active-session reads into repo hydration.

### `events/`

`events/session-events.ts`

- Single-session event dispatcher.
- Delegates status, part, tool, permission, question, and batching behavior to focused helpers.

`events/session-event-batching.ts`

- Keeps user messages, approvals, questions, idle, error, and finished events immediate.
- Batches noisy assistant/tool events so transcript updates stay coherent without losing terminal state.

`events/session-lifecycle.ts`

- Owns lifecycle transitions and pending permission/question state changes caused by runtime events.
- Applies UI-side read-only auto-rejection for mutating permission requests.
- User transcript rows are id-based upserts. OpenCode queued user turns must update the existing row in place when the runtime later marks the same message as read.
- Codex pending-input identity, question tool rows, and dynamic-tool rejection remain adapter-owned before normalized frontend events arrive.

`events/session-tool-parts.ts`

- Owns tool-row lifecycle updates.
- Triggers task-data refresh only when an ODT workflow mutation tool transitions to `completed`.
- Must not trigger duplicate completion side effects.
- Selected document reload/application after workflow tools is owned by Agent Studio document hooks, not by the event dispatcher.

### `hooks/`

`hooks/use-orchestrator-session-state.ts`

- In-memory store + refs bridge for orchestrator-owned session state.
- Still central, but now thinner because repo hydration, event transport, and active-session reads have clearer owners.

`hooks/use-agent-session-hydration.ts`

- Exposes bootstrap, requested-history hydration, live reconciliation, runtime-attachment retry, and view-readiness preparation as explicit operations.

`hooks/use-agent-session-listeners.ts`

- Owns attach/remove/unsubscribe behavior for runtime event listeners.

`hooks/use-agent-session-readers.ts`

- Exposes runtime-scoped request/response read delegates from the active `AgentEnginePort`.

`hooks/use-runtime-transcript-attachment.ts`

- Attaches runtime-only transcript sessions that do not start from a normal task workflow launch.

### `support/`

- `core.ts`: stale-repo guards and shared invariants.
- `persistence.ts`: persisted record mapping, history-to-chat conversion, and authoritative queued/read user-message projection.
- `session-prompt.ts`: prompt construction and requested-session prompt context loading.
- `session-runtime-metadata.ts`, `session-runtime-query-state.ts`, `session-runtime-attachment.ts`: runtime metadata and active-session query guards.
- `session-cache-effects.ts`: query-cache writes and invalidations caused by session persistence/stop operations.
- `models.ts`, `messages.ts`, `assistant-meta.ts`, `tool-messages.ts`, `question-messages.ts`, `todos.ts`: transcript/message/todo normalization helpers.

## Critical Invariants

These invariants must hold after any change:

1. Repo hydration is explicit
- bootstrap, reconcile, and requested-history hydration must remain separate intents
- runtime-attachment recovery and selected-session readiness must remain explicit intents
- avoid reintroducing one generic "loader" path with ad hoc flags

2. Session start policy is launch-action-owned
- callers choose a launch action
- allowed start modes come from `packages/frontend/src/features/session-start/session-start-launch-options.ts`
- UI resolves the actual mode and source session when needed
- `handlers/start-session.ts` executes the resolved start mode; it must not become the launch-action policy owner
- page code must not hardcode builder follow-up or PR-generation behavior outside the launch-action registry

3. Live runtime state wins over persisted hints
- for live resumed sessions, runtime status + runtime pending input are authoritative
- persisted pending permissions/questions are recovery data, not the primary live source of truth
- persisted runtime metadata identifies the runtime kind and working directory, but presence reads decide live/stale/persisted-only state

4. Event transport is shared at runtime boundary
- OpenCode uses one `/global/event` stream per runtime endpoint
- Codex uses app-server forwarding through one runtime-id subscription
- do not reintroduce per-session or per-worktree event streams at the frontend layer

5. Active-session reads stay query-owned
- model catalog, todos, history, slash commands, file search, repo config, task docs, dev-server state, and build worktree snapshots should remain request/response reads owned by TanStack Query or a dedicated read-model hook
- git diff state should stay behind the diff controller/read-model backed by `state/queries/git.ts`
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

- `handlers/start-session.test.ts`
  - fresh/reuse/fork start execution
  - stale rollback and persistence failure rollback
  - launch-action inputs after session-start UI resolution

- `handlers/start-session-runtime.test.ts`
  - role-specific runtime acquisition
  - build/QA working-directory target rules

- `lifecycle/load-sessions-requested-history.test.ts`
  - requested history hydration

- `lifecycle/load-sessions-requested-runtime.test.ts`
  - requested runtime routing

- `lifecycle/load-sessions-runtime-policy.test.ts`
  - runtime pending-input hydration

- `lifecycle/load-sessions-live-reattach.test.ts`
  - runtime-route reuse for already-attached live sessions

- `lifecycle/load-sessions-live-reconcile.test.ts`
  - live-session reconciliation

- `lifecycle/load-sessions-repo-concurrency.test.ts`
  - repo-scoped concurrency and stale guard behavior

- `lifecycle/repo-session-hydration-service.test.ts`
  - repo-scoped hydration coordinator behavior

- `lifecycle/ensure-ready.test.ts`
  - selected-session readiness and recovery gating

- `lifecycle/session-presence-source.test.ts`
  - stored/preloaded/scanned/direct presence read precedence

- `lifecycle/session-presence-store.test.ts`
  - short-lived repo presence reuse and expiry

- `events/session-transcript-events.test.ts`
  - transcript event application matrix

- `events/session-permissions-questions.test.ts`
  - permission/question handling

- `events/session-tool-parts.test.ts`
  - tool-row lifecycle and duplicate-completion side effects

- `events/session-errors-terminal.test.ts`
  - terminal error/idle/finished behavior

- `events/session-event-batching.test.ts`
  - immediate vs batched event behavior

- `packages/adapters-opencode-sdk/src/index.test.ts`
  - one global event stream per runtime endpoint

- `packages/adapters-codex-app-server/src/codex-app-server-adapter.streaming.test.ts`
- `packages/adapters-codex-app-server/src/codex-app-server-adapter.approvals.test.ts`
  - runtime-id app-server event subscription and pending request routing

- `packages/frontend/src/pages/agents/use-agent-studio-active-session-runtime-data.test.tsx`
  - query-gated active-session model catalog/todo hydration

- `packages/frontend/src/pages/agents/chat-composer/use-agent-studio-chat-composer.test.tsx`
  - composer/runtime read integration

- `packages/frontend/src/features/agent-chat-composer/prompt-input/create-chat-composer-file-search.test.ts`
  - file-search query behavior

- `packages/frontend/src/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands.test.ts`
  - slash-command catalog behavior

- `packages/frontend/src/components/features/agents/agent-chat/use-readonly-session-transcript-surface-model.test.tsx`
  - readonly transcript history hydration

- `packages/frontend/src/pages/agents/use-agent-studio-documents.test.tsx`
  - selected task document refresh after workflow tool completion

- `packages/frontend/src/features/agent-studio-git/use-agent-studio-diff-data.test.tsx`
  - build-tools diff read model behavior
  - visibility-driven refresh instead of timer polling

- `packages/frontend/src/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.test.tsx`
  - build-tools worktree snapshot composition

- `packages/frontend/src/state/queries/build-runtime.test.ts`
  - task worktree query behavior

- `packages/frontend/src/features/agent-studio-git/use-agent-studio-diff-polling.test.tsx`
  - diff polling controller behavior

- `packages/frontend/src/pages/agents/right-panel/use-agent-studio-dev-server-panel.hook.test.tsx`
  - dev-server query/subscription behavior

## Architecture Pressure Points

The refactor improved the system materially, but a few design choices are still carrying too much weight.

### 1. Session presence classification boundary

Session presence classification now has one orchestration-facing boundary:
`packages/frontend/src/state/operations/agent-orchestrator/lifecycle/session-presence.ts`.
It classifies normalized runtime snapshots from `AgentEnginePort.listSessionPresence`
and applies the same runtime/stale/persisted-only presence across hydration, live reattach,
and readiness recovery.

Runtime-specific interpretation stays in the runtime adapter. For OpenCode,
`packages/adapters-opencode-sdk/src/live-session-snapshots.ts` owns session list/status
payload parsing, pending approval/question grouping, directory normalization, and malformed
payload errors before frontend code sees normalized snapshots.

Presence lookup is now a small stack, not one cache:
- `repo-session-presence-preloads.ts` preloads runtime-kind/directory scans before hydration waves
- `session-presence-store.ts` shares fresh repo presence snapshots across hydration/recovery calls
- `session-presence-source.ts` decides stored -> preloaded -> scan-cache -> direct-read precedence
- `session-presence-cache.ts` groups adapter scans by repo path, runtime kind, and normalized working directory

Keep this boundary narrow:
- status + pending permissions + pending questions belong in the session presence path
- persisted runtime/session metadata decides stale vs persisted-only in frontend lifecycle code
- event streams still own post-attachment live updates
- TanStack Query still owns stable model catalog/todos reads

### 2. Build-tools read model is still split across feature and query layers

Build-tools ownership now mostly lives in `packages/frontend/src/features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.ts`, while the right panel composes that snapshot through page-level right-panel models.

That is better than the earlier right-panel bootstrap, but the ownership is still mixed:
- task worktree state is query-backed through `state/queries/build-runtime.ts`
- dev-server state is query/subscription-backed through `state/queries/dev-servers.ts`
- git diff state uses a dedicated controller/read model backed by `state/queries/git.ts`

Recommended next step:
- decide whether the build-tools snapshot should stay feature-local or move behind `state/queries`
- keep right-panel code as composition only
- avoid reintroducing timer-driven diff refreshes or repeated bootstrap reads

### 3. Documents remain eager for the selected task

Agent Studio still loads task docs eagerly for the selected task context. The selected-task document owner is now split between `use-agent-studio-documents.ts`, `state/queries/documents.ts`, and task-detail document hooks.

That is reasonable today, but if the page continues to grow, document loading may be worth making more explicit as:
- active transcript/session data
- active task document data
- workflow-tool optimistic document application

with clearer UI-level ownership.

## Safe Change Checklist

Before merging changes in this folder:

1. Keep bootstrap/reconcile/requested-history intent boundaries explicit.
2. Keep runtime-attachment recovery and selected-session readiness explicit.
3. Do not reintroduce interval-based background polling for build-tools diff reads.
4. Do not reintroduce repo-root model catalog reads while an active session owns its runtime catalog.
5. Keep `/global/event` as the only OpenCode event transport entrypoint.
6. Keep Codex app-server forwarding runtime-id scoped.
7. Preserve fail-fast runtime routing; never fall back to the wrong runtime kind or working directory.
8. Keep stable active-session reads query-owned or behind dedicated read models.
9. Run:
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test`
