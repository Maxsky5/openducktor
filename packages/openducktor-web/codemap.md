# packages/openducktor-web/

## Responsibility
Public local browser runner for OpenDucktor. It starts the Rust web host, waits for readiness, serves the shared frontend, and shuts the host down through a control-token endpoint.

## Design Patterns
- `src/cli.ts` keeps launcher side effects behind `import.meta.main`.
- `src/launcher.ts` owns orchestration, readiness polling, Vite startup, and shutdown behavior.
- `src/artifact-resolver.ts` resolves workspace binaries in development and packaged artifacts for published installs.

## Data & Control Flow
`bunx @openducktor/web` or `browser:dev` launches the loopback host, injects browser runtime config, wires `createBrowserShellBridge`, and serves the app on localhost. `src/browser-shell-bridge.ts` and `src/local-host-transport.ts` keep browser transport isolated from shared frontend code.

## Integration Points
- `packages/frontend`
- `packages/adapters-tauri-host`
- `apps/desktop/src-tauri/src/bin/openducktor_web_host.rs`
