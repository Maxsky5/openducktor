# apps/desktop/src-tauri/

## Responsibility
Tauri host root for the desktop app, browser-backend helper, and Rust workspace crates. It owns startup, command registration, and the bridge between the UI shell and host services.

## Design
Split into `src/` for Tauri-facing entrypoints and `crates/` for hexagonal host logic. Startup is fail-fast, blocking work is pushed off the UI thread, and runtime/config validation happens before the app continues.

## Flow
`src/main.rs` selects the desktop or browser-backend path, then `src/lib.rs` wires `AppService`, `TaskStore`, runtime registries, and event relays. Commands and headless handlers call into the application crate, which in turn uses infra adapters.

## Integration
Depends on `host-domain`, `host-application`, `host-infra-beads`, and `host-infra-system`, plus `capabilities/default.json` for Tauri permissions. Emits Tauri events and serves browser-backend traffic when running headless.
