# apps/desktop/src-tauri/src/

## Responsibility
Tauri-facing shell for desktop and browser-backend execution. It contains command wrappers, headless server glue, the helper bin, and app-level startup plumbing.

## Design
Commands are grouped by domain under `commands/`; browser mode uses `headless/` to register the same operations over HTTP/SSE. Shared helpers keep command handlers thin and push real work into `AppService`.

## Flow
`main.rs` decides between the desktop app and `run_browser_backend`; `lib.rs` builds state, services, and emitters; command modules validate request data, authorize paths, then delegate to service methods.

## Integration
Bridges Tauri, browser-backend HTTP, SSE relays, and the `host-application` service layer. Uses `host-domain` payloads throughout so UI and headless paths stay aligned.
