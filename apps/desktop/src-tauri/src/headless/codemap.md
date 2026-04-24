# apps/desktop/src-tauri/src/headless/

## Responsibility
Local web-host server path for OpenDucktor when the desktop shell is not driving the UI.

## Design
The folder splits command registration, command helpers, SSE/event relays, and request handlers into focused modules so the web host can reuse the same host services.

## Flow
`run_browser_backend_with_options` starts the server, registers command groups, validates the configured frontend origin/control token, and streams task/runtime/dev-server events back to the browser client.

## Integration
Bridges the browser-backend HTTP surface to `AppService`, Tauri event emitters, and the same domain contracts used by the desktop command layer.
