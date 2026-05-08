# packages/frontend/src/state/tasks/

## Responsibility

Task-specific normalization and error summaries for Beads-backed task loading.

## Design/Patterns

Pure error classifiers keep task-load failures actionable without hiding the underlying cause.

## Data & Control Flow

Task load errors are inspected and user-facing summary strings are produced for refresh/error toast flows.

## Integration Points

`use-task-operations.ts`, `task-load-errors.ts`, and task refresh/error toast flows.
