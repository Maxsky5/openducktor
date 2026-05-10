# apps/desktop/src-tauri/src/

## Responsibility
Tauri-facing shell for desktop execution. It contains app state, command helpers, logging, startup/shutdown plumbing, command wrappers, and desktop re-exports for the dedicated web-host crate.

## Design/Patterns
`app_state.rs`, `command_helpers.rs`, `logging.rs`, `startup.rs`, and `shutdown.rs` hold cross-cutting desktop host plumbing. Commands are grouped by domain under `commands/`; shared transport-neutral command payloads and behavior live in `crates/host-command-services`; and local web mode lives in `crates/web-host`.

## Data & Control Flow
`main.rs` starts the desktop app; `lib.rs` builds state, services, emitters, command registration, and web-host compatibility re-exports. Transport command modules validate and deserialize request data, then hand off to shared command-service modules from `host-command-services`.

## Integration Points
Bridges Tauri and the `host-application` service layer. Uses `host-domain` payloads and `host-command-services` DTOs so desktop UI commands and web-host routes stay aligned.
