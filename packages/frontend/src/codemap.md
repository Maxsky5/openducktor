# packages/frontend/src/

## Responsibility
Shared frontend application source for App, routes, shared components, feature orchestration, state/query layers, shell-neutral runtime helpers, styles, markdown/document preview helpers, and test utilities.

## Design Patterns
Route-level lazy loading in `pages/`, feature composition in `components`, typed host-backed data access in `state/queries`, side-effectful mutations in `state/operations`, and the shell-bridge/client utility seam in `lib/` for host capabilities.

## Data & Control Flow
`mount.tsx` bootstraps the app, `App.tsx` mounts providers and routes, and page components turn query/state slices into concrete feature models and dialogs. Shells configure `lib/shell-bridge.ts` before mounting.

## Integration Points
`components/layout` for shell chrome, `features/` for cross-page workflows, `lib/` for host/runtime utilities and shell bridge seams, `types/` for shared contracts, and `contexts/`/`test-utils/` for app-wide seams.
