# packages/frontend/src/state/operations/agent-orchestrator/lifecycle/

## Responsibility
Session hydration, loading, runtime attachment, live-session cache/store, and readiness recovery.

## Design Patterns
Lifecycle work is split into loaders, runtime-resolution helpers, and live-session cache/store modules so recoverability stays explicit.

## Data & Control Flow
Persisted session records are loaded, hydrated from route/runtime identifiers, merged with live transcript state, and reconciled against runtime availability before pages are allowed to interact with the session.

## Integration Points
`load-sessions.ts`, `session-loaders.ts`, `hydrate-*`, `reattach-live-session.ts`, `live-agent-session-*`, `ensure-ready.ts`, and runtime transcript merge helpers.
