# packages/frontend/src/state/operations/agent-orchestrator/lifecycle/

## Responsibility

Session hydration, loading, runtime attachment, session-presence cache/source/store, live-session cache/store, and readiness recovery.

## Design/Patterns

Lifecycle work is split into loaders, runtime-resolution helpers, and session-presence/live-session cache-store modules so recoverability stays explicit.

## Flow

Persisted session records are loaded, hydrated from durable session/runtime identifiers, matched against presence cache/store state, merged with live transcript state, and reconciled against runtime availability before pages interact with the session.

## Integration

`load-sessions.ts`, `session-loaders.ts`, `hydration-runtime-resolution.ts`, `hydration-runtime-policy.ts`, `reattach-live-session.ts`, `session-presence-*`, `live-agent-session-*`, `ensure-ready.ts`, and runtime transcript merge helpers.
