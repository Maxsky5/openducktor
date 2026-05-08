# apps/desktop/src-tauri/src/headless/

## Responsibility
Local web-host server path for OpenDucktor when the desktop shell is not driving the UI, including the browser-backend route handlers and test coverage.

## Design/Patterns
The folder splits command registry/support, per-domain command handlers, SSE/event relays, and request helpers into focused modules so the web host can reuse the same shared command services. It mirrors the desktop command surface instead of inventing a separate runtime path, and the server/parity tests keep the browser-backend registry aligned with the desktop commands.

## Data & Control Flow
`run_browser_backend_with_options` starts the server, registers command groups, validates the configured frontend origin/control token, and streams task/runtime/dev-server events back to the browser client. The tests exercise route auth, command dispatch, and browser-event behavior.

## Integration Points
Bridges the browser-backend HTTP surface to `AppService`, Tauri event emitters, and the same domain contracts and command-service modules used by the desktop command layer.
