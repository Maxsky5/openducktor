# packages/frontend/src/state/operations/agent-orchestrator/support/

## Responsibility
Pure helpers for agent-session orchestration internals.

## Design Patterns
Message shaping, persistence, prompts, scenarios, todos, assistant meta, runtime transcript merge helpers, and async side effects are split into small reusable utilities.

## Data & Control Flow
These helpers normalize payloads, subagent permission overlays, transcript message IDs, and derived session state before the handlers/lifecycle code commits anything to the store.

## Integration Points
`messages.ts`, `persistence.ts`, `scenario.ts`, `todos.ts`, `assistant-meta.ts`, `core.ts`, `session-prompt.ts`, and runtime transcript merge helpers.
