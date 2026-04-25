# packages/frontend/src/components/features/pull-requests/

## Responsibility
Pull-request confirmation UI used when linking a merged PR back to a task.

## Design Patterns
Single-purpose modal/dialog components with a small model surface and explicit confirm/cancel callbacks.

## Data & Control Flow
Task refresh and PR-linking flows populate the dialog model; the user confirms or cancels and the page model continues the mutation pipeline.

## Integration Points
Kanban page task approval flows, Agent Studio git panel flows, and task mutation/query invalidation.
