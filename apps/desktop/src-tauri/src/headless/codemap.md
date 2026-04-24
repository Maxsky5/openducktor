# apps/desktop/src-tauri/src/headless/

## Responsibility
Browser-backend server path for OpenDucktor when the desktop shell is not driving the UI.

## Design
The folder splits command registration, command helpers, SSE/event relays, and request handlers into focused modules so the browser backend can reuse the same host services.

## Flow
`run_browser_backend` starts the server, registers command groups, and streams task/runtime/dev-server events back to the browser client.

## Integration
Bridges the browser-backend HTTP surface to `AppService`, Tauri event emitters, and the same domain contracts used by the desktop command layer.
