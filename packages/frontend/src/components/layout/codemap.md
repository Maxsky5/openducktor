# packages/frontend/src/components/layout/

## Responsibility
App chrome for the shell: sidebar/workspace rail, main outlet frame, overlays, and theme wiring.

## Design Patterns
Composition over stateful layout logic. The shell delegates workspace/sidebar/theme behavior to focused subcomponents and hooks.

## Data & Control Flow
`AppShell` receives app-state slices and renders the workspace rail, sidebar, content outlet, and repository modal while preserving global screen layout.

## Integration Points
`app-shell.tsx`, `application-overlays.tsx`, `theme-provider.tsx`, `theme-dom.ts`, and `components/layout/sidebar`.
