# packages/frontend/

## Responsibility

Shared React/Vite frontend package for OpenDucktor. It owns App composition, reusable components, route screens, app-state/query orchestration, styles, markdown/document helpers, test utilities, and the shell-bridge contract used by desktop and browser shells.

## Design/Patterns

- `src/index.ts` exposes the package entrypoint, shell bootstrap API, styles subpath, and shell-bridge contract types.
- `src/shell-bootstrap-workflow.ts` owns the shared bootstrap sequence; `src/shell-bootstrap.tsx` binds that workflow to the DOM, router, theme preload, and crash shell.
- `src/lib/shell-bridge.ts` is the host boundary. Shared UI code reaches host operations through this bridge instead of importing shell transport APIs directly.
- `src/components`, `src/pages`, `src/state`, `src/features`, `src/lib`, and `src/test-utils` keep the layered frontend structure, now shell-neutral.

## Flow

Shells call `bootstrapOpenDucktorShell(...)` with shell-specific bridge inputs. The shared workflow resolves the root, configures the bridge, preloads settings/theme, and renders the app through the configured shell bridge.

## Integration

Desktop integration lives in `apps/electron/src/renderer/electron-shell-bridge.ts`; shared host seams live in `src/lib/shell-bridge.ts` and the browser/web shell adapters.
