# packages/frontend/src/

## Responsibility

Shared frontend application source for App, routes, shared components, feature orchestration, state/query layers, shell bootstrap, shell-neutral runtime helpers, styles, markdown/document preview helpers, and test utilities.

## Design/Patterns

Route-level lazy loading in `pages/`, feature composition in `components`, typed host-backed reads in `state/queries`, side-effectful mutations in `state/operations`, and the shell-bridge/client seam in `lib/` for host capabilities.

## Flow

`shell-bootstrap-workflow.ts` owns startup ordering; `shell-bootstrap.tsx` resolves the root, configures the bridge, preloads settings/theme, mounts the router, and renders `App.tsx`. Page components turn query/state slices into concrete feature models and dialogs.

## Integration

`components/layout` for shell chrome, `features/` for cross-page workflows, `lib/` for host/runtime utilities and shell bridge seams, `types/` for shared contracts, and `contexts/`/`test-utils/` for app-wide seams.
