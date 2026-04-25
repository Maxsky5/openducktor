# packages/frontend/src/state/operations/tasks/

## Responsibility
Task mutation operations for create/update/transition/defer/reset/delete, plus PR and QA workflow actions.

## Design Patterns
The task operation hook is a command surface over host calls, with a separate model module for shared normalization and success/error messages.

## Data & Control Flow
User actions mutate the active repo through host commands, then refresh task/document/query caches and surface toast feedback.

## Integration Points
`use-task-operations.ts`, `task-operations-model.ts`, `task-load-errors.ts`, and task-related React Query keys.
