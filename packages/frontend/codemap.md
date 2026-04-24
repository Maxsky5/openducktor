# packages/frontend/

## Responsibility

Shared React/Vite frontend package for OpenDucktor. It owns the reusable app UI, routes, app-state/query orchestration, styles, and the shell bridge contract used by both desktop and local web shells.

## Design Patterns

- `src/index.ts` exposes the package entrypoint, app mount helper, styles subpath, and shell bridge contract.
- `src/lib/shell-bridge.ts` is the host boundary. Shared UI code reaches host operations through this bridge instead of importing Tauri or web transport APIs directly.
- `src/components`, `src/pages`, `src/state`, and `src/features` keep the previous layered frontend structure, now shell-neutral.

## Data & Control Flow

Shells call `configureShellBridge(...)`, then `mountOpenDucktorApp(rootElement)`. The shared app preloads settings/theme, renders routes, and uses `hostClient`/event subscriptions through the configured bridge.

## Integration Points

Desktop integration lives in `apps/desktop/src/desktop-shell-bridge.ts`; web integration lives in `packages/openducktor-web/src/browser-shell-bridge.ts` and `local-host-transport.ts`.
