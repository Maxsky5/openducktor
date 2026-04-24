# apps/desktop/src/

## Responsibility
Frontend application source for routes, shared components, feature orchestration, state/query layers, and desktop-specific runtime helpers.

## Design Patterns
Route-level lazy loading in `pages/`, feature composition in `components/`, typed host-backed data access in `state/queries`, and side-effectful mutations in `state/operations`.

## Data & Control Flow
`main.tsx` bootstraps the app, `App.tsx` mounts providers and routes, and page components turn query/state slices into concrete feature models and dialogs.

## Integration Points
`components/layout` for shell chrome, `features/` for cross-page workflows, `lib/` for host/runtime utilities, `types/` for shared contracts, and `contexts/`/`test-utils/` for app-wide seams.
