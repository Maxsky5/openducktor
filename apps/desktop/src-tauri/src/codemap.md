# apps/desktop/src-tauri/src/

## Responsibility
Tauri-facing shell for desktop and local web-host execution. It contains app state, command helpers/payloads, logging, startup/shutdown plumbing, command wrappers, headless server glue, and the dedicated web-host binary.

## Design
`app_state.rs`, `command_helpers.rs`, `command_payloads.rs`, `logging.rs`, `startup.rs`, and `shutdown.rs` hold cross-cutting host plumbing. Commands are grouped by domain under `commands/`; shared transport-neutral command behavior lives under `command_services/`; local web mode uses `headless/` to register the same operations over HTTP/SSE; and `bin/openducktor_web_host.rs` provides the standalone web-host entrypoint.

## Flow
`main.rs` starts the desktop app and keeps the browser-backend compatibility flag; `lib.rs` builds state, services, emitters, and command registration before delegating to startup/headless. Transport command modules validate and deserialize request data, then hand off to shared command-service modules.

## Integration
Bridges Tauri, browser-backend HTTP, SSE relays, and the `host-application` service layer. Uses `host-domain` payloads throughout so UI and headless paths stay aligned.
