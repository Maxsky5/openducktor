# apps/desktop/

## Responsibility
Tauri desktop workspace for OpenDucktor. The shared browser UI now lives in `packages/frontend`; this workspace owns the thin Tauri shell, desktop shell bridge, Tauri configuration, and package-level scripts that launch or build the desktop app.

## Design Patterns
Thin-shell boundary: `src/main.tsx` configures a Tauri-backed shell bridge and mounts `@openducktor/frontend`; shared routes, components, state, and feature code stay in `packages/frontend/src`.

## Data & Control Flow
`src/main.tsx` creates the desktop shell bridge, registers it with the shared frontend, imports shared styles, and delegates rendering to `mountOpenDucktorApp`.

## Integration Points
`package.json`, `vite.config.ts`, `src/desktop-shell-bridge.ts`, `src-tauri` command/runtime boundaries, and `scripts/*.ts` build/CEF/Tauri helpers.
