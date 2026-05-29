# packages/openducktor-web/

## Responsibility
Public local browser runner and browser shell bridge for OpenDucktor. It starts the TypeScript host backend, writes browser runtime config, serves the shared frontend, and shuts the host down through a control-token endpoint.

## Design Patterns
- `src/cli.ts` keeps launcher side effects behind `import.meta.main`.
- `src/launcher.ts` owns orchestration, readiness polling, Vite startup, runtime-config emission, and shutdown behavior.
- `src/typescript-host-backend.ts` adapts `@openducktor/host` to the browser HTTP/SSE contract, including app-token sessions, command invocation, host event streams, local attachment previews, and control-token shutdown.
- `src/browser-shell-bridge.ts` owns the frontend bridge surface for browser-specific host capabilities.
- Package metadata publishes `web` and `openducktor-web` bin aliases from the CLI build via `main`, `exports`, and `bin`.

## Data & Control Flow
`bunx @openducktor/web` or `browser:dev` launches the loopback TypeScript host, injects browser runtime config, supplies runtime readiness plus `createBrowserShellBridge` to the shared frontend bootstrap, and serves the app on localhost. `src/cli.ts` is the package entrypoint, `src/web-runtime-distribution.ts` chooses between workspace source mode and the self-contained npm package MCP artifact, `src/runtime-config.ts` loads the injected config into browser state; `src/browser-shell-bridge.ts` and `src/local-host-transport.ts` keep browser transport isolated from shared frontend code.

## Integration Points
- `packages/frontend`
- `packages/host-client`
- `packages/host`
