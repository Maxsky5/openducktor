# packages/frontend/src/pages/

## Responsibility
Route-level screens for the Kanban board and Agent Studio, plus the lazy loaders consumed by `App.tsx`.

## Design Patterns
Pages are thin composition layers: they assemble feature components, call page-model hooks, and forward callbacks into modals, sheets, and panels.

## Data & Control Flow
Query params, workspace state, and React Query data feed page models; those models drive dialog visibility, session/task selection, and right-panel state.

## Integration Points
`App.tsx` routes, `pages/index.ts` lazy loaders, `components/features/*` modals/panels, and `state/*` orchestration hooks.
