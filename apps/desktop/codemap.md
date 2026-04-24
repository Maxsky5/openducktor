# apps/desktop/

## Responsibility
React/Vite desktop frontend for OpenDucktor. This workspace owns the browser UI, shared app state, and package-level scripts that launch or build the desktop shell.

## Design Patterns
Layered frontend boundaries: `src/components` renders UI, `src/pages` composes routes, `src/state` owns host/query orchestration, and `src/lib` contains pure/shared utilities.

## Data & Control Flow
`src/main.tsx` preloads settings, applies the theme, and mounts `App`. `App.tsx` wires query/state providers, route switches, and cross-page overlays.

## Integration Points
`package.json`, `vite.config.ts`, `src/styles.css`, `src-tauri` command/runtime boundaries, and `scripts/*.ts` build/CEF/Tauri helpers.
