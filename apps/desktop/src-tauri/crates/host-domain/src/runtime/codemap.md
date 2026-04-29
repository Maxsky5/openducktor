# apps/desktop/src-tauri/crates/host-domain/src/runtime/

## Responsibility
Runtime descriptors, routes, events, and live runtime state summaries.

## Design
The module is split into `registry`, `route`, `events`, and `state`. `registry` is a directory module with separate files for runtime kinds, capability contracts, descriptor validation, startup config, built-in OpenCode metadata, and registry mechanics. `RuntimeRoute` keeps the live connection shape explicit, and `RuntimeInstanceSummary` only carries live metadata for an active runtime; it does not duplicate endpoint, port, or capability fields.

## Flow
The application crate resolves runtime kinds through the registry, materializes a route for the active session, and publishes runtime/dev-server/run events and health summaries through these types.

## Integration
Used by runtime startup, MCP status checks, build/session orchestration, and the browser-backend event relay.
