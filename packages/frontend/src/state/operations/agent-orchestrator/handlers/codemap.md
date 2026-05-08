# packages/frontend/src/state/operations/agent-orchestrator/handlers/

## Responsibility

Session action handlers and start-session strategies for the agent orchestrator.

## Design/Patterns

Command implementations choose between reuse, fork, and fresh-start strategies and expose public session actions.

## Data & Control Flow

Handlers receive normalized start-session inputs, resolve the right runtime/session strategy, and update persisted and session-local state as the workflow progresses.

## Integration Points

`session-actions.ts`, `public-operations.ts`, `start-session*.ts`, `start-session-runtime.ts`, `start-session-support.ts`, `start-session-persistence.ts`, `start-session-reuse-strategy.ts`, `start-session-fresh-strategy.ts`, and `start-session-fork-strategy.ts`.
