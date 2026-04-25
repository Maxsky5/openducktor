# packages/frontend/src/state/lifecycle/

## Responsibility
Lifecycle state helpers for app startup and readiness, especially checks loading heuristics.

## Design Patterns
Small predicates keep app bootstrap logic out of UI components.

## Data & Control Flow
The app compares cached checks/runtime data to decide whether it still needs to load or can proceed with the current snapshot.

## Integration Points
`app-lifecycle-model.ts`, `use-app-lifecycle.ts`, and the app-state provider startup flow.
