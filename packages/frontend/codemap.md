# packages/frontend/

## Responsibility

Shared React/Vite frontend package for OpenDucktor. It owns App composition, reusable components, route screens, app-state/query orchestration, styles, markdown/document helpers, test utilities, and the shell-bridge contract used by desktop and local web shells.

## Design Patterns

- `src/index.ts` exposes the package entrypoint, shell bootstrap API, styles subpath, and shell-bridge contract types.
- `src/shell-bootstrap.tsx` owns shared startup ordering: shell readiness, root resolution, bridge configuration, settings/theme preload, crash shell, router, and app render.
- `src/lib/shell-bridge.ts` is the host boundary. Shared UI code reaches host operations through this bridge instead of importing Tauri or web transport APIs directly.
- `src/components`, `src/pages`, `src/state`, `src/features`, `src/lib`, and `src/test-utils` keep the layered frontend structure, now shell-neutral.

## Data & Control Flow

Shells call `bootstrapOpenDucktorShell(...)` with shell-specific readiness and bridge factory inputs. The shared bootstrap resolves the root, configures the bridge, preloads settings/theme, renders routes, and uses `hostClient`/event subscriptions through the configured bridge.

## Integration Points

Desktop integration lives in `apps/desktop/src/desktop-shell-bridge.ts`; web integration lives in `packages/openducktor-web/src/browser-shell-bridge.ts` and `local-host-transport.ts`.
