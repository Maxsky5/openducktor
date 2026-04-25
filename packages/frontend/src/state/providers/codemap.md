# packages/frontend/src/state/providers/

## Responsibility
Context providers that back the app state slices exposed by `AppStateProvider`.

## Design Patterns
Each provider owns one slice or service boundary (workspace, checks, tasks, delegation, spec, autopilot, agent studio, lifecycle, runtime).

## Data & Control Flow
Providers ingest host/query/operation dependencies and expose stable context values for hooks and page models.

## Integration Points
`app-state-provider.tsx`, `app-state-contexts.ts`, and the `state/operations` and `state/queries` layers.
