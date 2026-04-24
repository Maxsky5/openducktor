# packages/openducktor-web/

## Responsibility

Public local browser runner for OpenDucktor. It provides the `@openducktor/web` CLI that starts the Rust web host, waits for readiness, serves the shared frontend through Vite, and shuts the host down through an explicit control-token endpoint.

## Design Patterns

- `src/cli.ts` parses launcher flags and keeps side effects behind `import.meta.main` for testability.
- `src/launcher.ts` owns process orchestration, readiness polling, Vite startup, signal handling, and fail-fast shutdown behavior.
- `src/artifact-resolver.ts` resolves either the workspace Cargo binary during development or a signed/checksummed packaged macOS host binary for published installs.
- `src/local-host-transport.ts` owns the browser HTTP/SSE transport; shared frontend code does not import it directly.

## Data & Control Flow

`bunx @openducktor/web` launches `openducktor-web-host` on loopback, injects `VITE_ODT_BROWSER_BACKEND_URL` into Vite, configures the shared frontend with `createBrowserShellBridge`, and serves the app on `http://127.0.0.1:<port>`.

## Integration Points

Integrates with `packages/frontend` for the React app, `packages/adapters-tauri-host` for typed command client construction, and `apps/desktop/src-tauri/src/bin/openducktor_web_host.rs` for the local Rust host binary.
