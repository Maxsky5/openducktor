# apps/desktop/src-tauri/

## Responsibility
Tauri host root for the desktop app, dedicated web-host binary, generated host artifacts, and Rust workspace crates. It owns startup/shutdown, logging, command registration, and the bridge between the UI shell, headless HTTP/SSE path, and host services.

## Design
Split into `src/` for Tauri-facing entrypoints and transport glue, `crates/` for hexagonal host logic, and `gen/` for generated bindings/schemas. Startup is fail-fast, blocking work is pushed off the UI thread, and lifecycle concerns stay isolated in `startup.rs`, `shutdown.rs`, `logging.rs`, and `app_state.rs`.

## Flow
`src/main.rs` selects the desktop or browser-backend path, `src/bin/openducktor_web_host.rs` starts the dedicated web host, and `src/lib.rs` wires startup, shutdown, logging, command services, and event relays around `AppService`. Commands and headless handlers call into the application crate, which in turn uses infra adapters and generated command schemas.

## Integration
Depends on `host-domain`, `host-application`, `host-infra-beads`, and `host-infra-system`, plus `capabilities/default.json` and generated schema artifacts for Tauri permissions and IPC surfaces. Emits Tauri events and serves browser-backend traffic when running headless.
