# packages/frontend/src/components/

## Responsibility
Reusable UI and feature widgets used across pages, including layout chrome, shadcn primitives, error screens, markdown/document preview controls, and feature-specific panels/modals.

## Design Patterns
Component groups are organized by concern (`layout`, `features`, `ui`, `errors`) and usually pair renderers with local model/controller hooks.

## Data & Control Flow
Pages and shell code pass prepared models into these components; local hooks mostly translate state/query data into view models and callback handlers.

## Integration Points
`pages/` route shells, `state/` hooks, `lib/` helpers, `features/` cross-cutting workflows, and `QueryProvider`/`AppStateProvider` consumers.
