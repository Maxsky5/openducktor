# packages/frontend/src/state/operations/agent-orchestrator/

## Responsibility
Agent-session orchestration: load, hydrate, start, stop, attach, reconcile, and persist live sessions and transcripts.

## Design Patterns
The root module re-exports handlers, lifecycle loaders, runtime loaders, events, and shared helpers so page code can consume one orchestration surface.

## Data & Control Flow
Host/runtime/session state is loaded into `AgentSessionState`, updated via event streams, and persisted back into durable records when workflows start or recover.

## Integration Points
`handlers/`, `events/`, `hooks/`, `lifecycle/`, `runtime/`, `support/`, and `state/agent-sessions-store`.
