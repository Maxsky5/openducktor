# apps/desktop/src-tauri/src/

## Responsibility
Tauri-facing shell for desktop and local web-host execution. It contains command wrappers, headless server glue, the dedicated web-host binary, and app-level startup plumbing.

## Design
Commands are grouped by domain under `commands/`; local web mode uses `headless/` to register the same operations over HTTP/SSE, and `bin/openducktor_web_host.rs` provides the standalone web-host entrypoint. Shared helpers keep command handlers thin and push real work into `AppService`, while generated schemas keep IPC shapes aligned.

## Flow
`main.rs` starts the desktop app and keeps the legacy browser-backend compatibility flag; `bin/openducktor_web_host.rs` starts the dedicated web host with a required frontend origin and control token. `lib.rs` builds state, services, emitters, and command registration; command modules validate request data, authorize paths, then delegate to service methods.

## Integration
Bridges Tauri, browser-backend HTTP, SSE relays, and the `host-application` service layer. Uses `host-domain` payloads throughout so UI and headless paths stay aligned.
