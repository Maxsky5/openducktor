# apps/desktop/src-tauri/crates/web-host/

## Responsibility
Dedicated local web-host crate for browser mode. It owns the standalone binary, HTTP command routes, SSE event relay, static frontend serving, startup/shutdown hooks, and web-host tests.

## Design/Patterns
The crate keeps web-specific routing, logging, process cleanup, and event delivery separate from the desktop Tauri crate. Shared command DTOs and transport-neutral command behavior come from `host-command-services` instead of importing desktop source files by path.

## Data & Control Flow
`src/main.rs` parses launcher inputs and starts the host. `src/startup.rs` wires services and readiness, `src/headless/` exposes browser-backend routes, and command handlers call into `host-command-services` and `host-application` before serializing HTTP responses.

## Integration Points
Used by `packages/openducktor-web` in workspace mode and by published web artifacts. Depends on host application/domain/infra crates but must not depend on Tauri.
