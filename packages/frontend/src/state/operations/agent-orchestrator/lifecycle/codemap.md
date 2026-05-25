# packages/frontend/src/state/operations/agent-orchestrator/lifecycle/

## Responsibility

Session hydration, loading, runtime attachment, operation-scoped session-presence source/cache, live-session reconciliation, and readiness recovery.

## Design/Patterns

Lifecycle work is split into loaders, runtime-resolution helpers, operation-scoped presence helpers, and reattach logic so recoverability stays explicit.

## Data & Control Flow

Persisted session records are loaded, hydrated from durable session/runtime identifiers, merged with live transcript state, and reconciled against runtime availability before pages interact with the session.

## Integration Points

`load-sessions.ts`, `session-loaders.ts`, `hydration-runtime-resolution.ts`, `hydration-runtime-policy.ts`, `reattach-live-session.ts`, `session-presence-source.ts`, `session-presence-cache.ts`, `repo-session-hydration-service.ts`, `repo-session-presence-preloads.ts`, `session-view-lifecycle.ts`, `ensure-ready.ts`, and `session-hydration-operations.ts`.
