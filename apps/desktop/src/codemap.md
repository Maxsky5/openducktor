# apps/desktop/src/

## Responsibility
Thin desktop shell source for the Tauri application. Shared routes, components, feature orchestration, state/query layers, and host-backed UI utilities live under `packages/frontend/src`.

## Design Patterns
Keep this folder intentionally small. Shell-specific code configures `ShellBridge` implementations and delegates all shared rendering to `@openducktor/frontend`.

## Data & Control Flow
`main.tsx` configures `createDesktopShellBridge()`, imports `@openducktor/frontend/styles.css`, and calls `mountOpenDucktorApp(rootElement)`.

## Integration Points
`desktop-shell-bridge.ts` is the only Tauri API usage in this folder. It adapts Tauri invoke/event APIs to the shared frontend shell bridge contract.
