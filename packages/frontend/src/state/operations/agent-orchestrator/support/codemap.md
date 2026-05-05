# packages/frontend/src/state/operations/agent-orchestrator/support/

## Responsibility

Pure helpers for agent-session orchestration internals.

## Design/Patterns

Message shaping, persistence, kickoff prompts, session-runtime query state, todos, assistant meta, runtime transcript merge helpers, and async side effects are split into small reusable utilities.

## Flow

These helpers normalize payloads, subagent approval overlays, transcript message IDs, runtime query inputs, and derived session state before the handlers/lifecycle code commits anything to the store.

## Integration

`messages.ts`, `persistence.ts`, `todos.ts`, `assistant-meta.ts`, `core.ts`, `session-prompt.ts`, `kickoff-prompts.ts`, `session-runtime-query-state.ts`, and runtime transcript merge helpers.
