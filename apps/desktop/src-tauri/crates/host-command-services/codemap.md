# apps/desktop/src-tauri/crates/host-command-services/

## Responsibility
Transport-neutral command payload DTOs and command-service helpers shared by the desktop Tauri command layer and the local web-host HTTP command layer.

## Design/Patterns
This crate is the explicit shared ownership boundary for command behavior that is not tied to Tauri IPC or web-host routing. It depends inward on `host-application`, `host-domain`, and host infra helpers, while callers adapt transport-specific payload parsing, response serialization, and event delivery outside the crate.

## Data & Control Flow
Desktop command wrappers and web-host headless handlers build request DTOs from their transport inputs, call command services in this crate, then map results back to their transport-specific responses/errors.

## Integration Points
Used by `apps/desktop/src-tauri/src/commands/*` and `apps/desktop/src-tauri/crates/web-host/src/headless/*`.
