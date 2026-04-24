# apps/desktop/src/state/operations/agent-orchestrator/handlers/

## Responsibility
Session action handlers and start-session strategies for the agent orchestrator.

## Design Patterns
This folder contains the command implementations that choose between reuse, fork, and fresh-start strategies and expose public session actions.

## Data & Control Flow
Handlers receive normalized start-session inputs, resolve the right runtime/session strategy, and update persisted/session-local state as the workflow progresses.

## Integration Points
`session-actions.ts`, `public-operations.ts`, `start-session*.ts`, and the higher-level orchestrator hook.
