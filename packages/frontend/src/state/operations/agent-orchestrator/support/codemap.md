# packages/frontend/src/state/operations/agent-orchestrator/support/

## Responsibility

Pure helpers for agent-session orchestration internals.

## Design/Patterns

Message shaping, persistence, kickoff prompts, session-runtime query state, todos, assistant meta, runtime transcript merge helpers, and async side effects are split into small reusable utilities.

## Data & Control Flow

These helpers normalize payloads, subagent approval overlays, transcript message IDs, runtime query inputs, and derived session state before the handlers and lifecycle code commit anything to the store.

## Integration Points

`messages.ts`, `persistence.ts`, `todos.ts`, `assistant-meta.ts`, `core.ts`, `session-prompt.ts`, `kickoff-prompts.ts`, `session-runtime-query-state.ts`, `session-runtime-metadata.ts`, `session-runtime-attachment.ts`, `runtime-transcript-session.ts`, `hydrated-message-merge.ts`, `async-side-effects.ts`, and `subagent-approval-overlay.ts`.
