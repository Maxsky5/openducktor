# packages/frontend/src/state/read-models/

## Responsibility
Derived read-model transforms for state data that should stay separate from direct host DTOs.

## Design Patterns
Tiny pure selectors normalize backend payloads before the data reaches page models or components.

## Data & Control Flow
Raw task and workspace data is filtered or shaped into user-facing read models, such as visible Kanban tasks.

## Integration Points
`task-read-model.ts` and any state/query modules that need canonical visibility rules.
