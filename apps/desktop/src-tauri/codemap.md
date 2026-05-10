# apps/desktop/src-tauri/

## Responsibility
Tauri host root for the desktop app, dedicated web-host binary, generated host artifacts, and Rust workspace crates. It owns startup/shutdown, logging, command registration, and the bridge between the UI shell, headless HTTP/SSE path, and host services.

## Design/Patterns
Split into `src/` for Tauri-facing entrypoints and transport glue, `crates/` for hexagonal host logic plus shared command services, and `gen/` for generated bindings/schemas. Startup is fail-fast, blocking work is pushed off the UI thread, and lifecycle concerns stay isolated in `startup.rs`, `shutdown.rs`, `logging.rs`, and `app_state.rs`. Headless browser-backend routes and tests stay alongside their owning host surface while shared command behavior lives in `crates/host-command-services` so the desktop and web-host surfaces remain aligned.

## Data & Control Flow
`src/main.rs` selects the desktop path, `src/lib.rs` wires startup, shutdown, logging, command services, and event relays around `AppService`, and `crates/web-host` owns the dedicated local web host. Commands and headless handlers share transport-neutral command payloads/services from `crates/host-command-services`, which call into the application crate and infra adapters.

## Integration Points
Depends on `host-domain`, `host-application`, `host-infra-beads`, and `host-infra-system`, plus `capabilities/default.json` and generated schema artifacts for Tauri permissions and IPC surfaces. Emits Tauri events and serves browser-backend traffic when running headless.
