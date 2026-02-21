# Agent Orchestrator Module Map (Desktop)

This document is the compact maintenance map for `apps/desktop/src/state/operations/agent-orchestrator`.

It captures:
- module responsibilities,
- non-negotiable invariants,
- where regressions are pinned by tests.

## Public Boundary

`apps/desktop/src/state/operations/agent-orchestrator/index.ts`

- Exposes the orchestration entrypoints used by `use-agent-orchestrator-operations.ts`.
- Keeps callers decoupled from folder internals.
- Public exports are intentionally narrow:
  - `attachAgentSessionListener`
  - `createAgentSessionActions`
  - `createLoadAgentSessions`
  - runtime helpers (`createEnsureRuntime`, `loadRepoDefaultModel`, `loadTaskDocuments`)
  - utility helpers for persistence/todos/model normalization.

## Module Responsibilities

### `events/`

`events/session-events.ts`

- Owns adapter stream event handling for a single session subscription.
- Uses typed dispatch + per-event handlers (instead of monolithic branch chain).
- Keeps side effects explicit:
  - permission auto-reply,
  - task refresh after ODT mutation tools,
  - todos refresh after todo tool completion.
- Handles draft lifecycle transitions (delta/part/message/error/idle/finished) and message timeline updates.

### `handlers/`

`handlers/session-actions.ts`

- Owns user-driven operations (`send`, `start`, `stop`, `replyPermission`, `answerQuestion`, model switch).
- Delegates start flow to `start-session.ts`.
- Guarantees local state cleanup on stop even if remote stop fails.

`handlers/start-session.ts`

- Owns session start orchestration and reuse policy.
- Enforces in-flight dedupe (`repoPath::taskId` key).
- Reuse order:
  1. latest in-memory task session,
  2. latest persisted task session,
  3. create new remote session.
- Performs stale workspace guards across async boundaries.
- Rolls back remote session if workspace turns stale after start.

### `lifecycle/`

`lifecycle/ensure-ready.ts`

- Ensures an existing local session is attached/resumed in runtime.
- Reattaches listener for healthy attached sessions.
- Recovers from attached error sessions via stop + resume.
- Rolls back resumed remote session if workspace turns stale after resume.

`lifecycle/load-sessions.ts`

- Hydrates persisted sessions for a task into in-memory state.
- Loads history when needed and maps history parts into UI messages.
- Applies stale guard checks during hydration and side-effect warmups.

### `runtime/`

`runtime/runtime.ts`

- Resolves runtime info per role and task.
- Loads repo-level default model and task docs.
- Keeps runtime acquisition logic out of handlers/events.

### `support/`

- `core.ts`: shared constants and invariants helpers (`runningStates`, read-only role set, stale guard primitives).
- `messages.ts`: message upsert primitive.
- `assistant-meta.ts`: assistant metadata and draft finalization.
- `tool-messages.ts`: tool input/output normalization and tool message id resolution.
- `todos.ts`: todo normalization, parsing, merge semantics.
- `question-messages.ts`: annotate question tool rows with answered payloads.
- `models.ts`: model selection normalization/default selection.
- `persistence.ts`: persisted session mapping + history-to-chat conversion.
- `scenario.ts`: scenario inference and kickoff prompt generation.
- `utils.ts`: support export barrel.

## Critical Invariants

These invariants must hold after any change:

1. **One active start flow per repo/task key**
   - enforced by `inFlightStartsByRepoTaskRef` in `start-session.ts`.

2. **Stale workspace operations must not leak remote sessions**
   - stale after `startSession` -> best-effort `stopSession` rollback.
   - stale after `resumeSession` -> best-effort `stopSession` rollback.

3. **Read-only roles auto-reject mutating permissions**
   - if auto-reply fails, permission must remain actionable in pending state and emit a system error message.

4. **Stop action always leaves deterministic local terminal state**
   - session marked `stopped`, pending permission/question queues cleared,
   - even when remote stop throws.

5. **Draft finalization consistency**
   - assistant draft text must be finalized/cleared on terminal events (`assistant_message`, `session_idle`, `session_error`, `session_finished`) according to existing flow.

6. **No duplicate completion side effects for tool rows**
   - task refresh and todos refresh trigger only on first transition to completed for relevant tool rows.

7. **Session lookup recency is deterministic**
   - latest session selection uses `startedAt`, then `sessionId` tie-breaker.

## Regression Test Anchors

Use these files as the first-line safety net:

- `events/session-events.test.ts`
  - stream part handling matrix,
  - read-only permission auto-reject + failure fallback,
  - session status/error/finished transitions.

- `handlers/start-session.test.ts`
  - in-flight dedupe,
  - reuse order,
  - stale guard checks,
  - stale-after-start rollback.

- `lifecycle/ensure-ready.test.ts`
  - healthy attached reattach path,
  - attached error recovery path,
  - stale-after-resume rollback,
  - missing local session guard.

- `handlers/session-actions.test.ts`
  - send/stop behavior,
  - stop cleanup despite remote failure,
  - permission/question response state updates.

- `lifecycle/load-sessions.test.ts`
  - hydration entry constraints,
  - stale short-circuit behavior.

## Safe Change Checklist

Before merging changes in this folder:

1. Keep public API unchanged unless all call sites are updated.
2. Preserve stale rollback semantics in start/resume paths.
3. Preserve read-only permission policy behavior and failure fallback.
4. Preserve deterministic session reuse ordering.
5. Run:
   - `bun run --filter @openducktor/desktop typecheck`
   - `bun run --filter @openducktor/desktop lint`
   - `bun run --filter @openducktor/desktop test`
