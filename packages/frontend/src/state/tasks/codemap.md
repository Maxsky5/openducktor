# packages/frontend/src/state/tasks/

## Responsibility
Task-specific normalization and error summaries for Beads-backed task loading.

## Design Patterns
Pure error classifiers and repo-store health checks keep task-load failures actionable without hiding the underlying cause.

## Data & Control Flow
Task load errors are inspected, repo-store health is mapped into blocking/unavailable states, and user-facing summary strings are produced.

## Integration Points
`use-task-operations.ts`, `repo-store-health.ts`, and task refresh/error toast flows.
