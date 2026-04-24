# apps/desktop/src/components/features/kanban/

## Responsibility
Kanban board renderers, task cards, workflow controls, virtualization, and status/theme presentation.

## Design Patterns
Board, column, and card helpers are split from workflow/action utilities so rendering remains cheap and state-agnostic.

## Data & Control Flow
Task lists and workflow state flow into columns/cards, which surface actions back to page models for approval, reset, or session-start workflows.

## Integration Points
`pages/kanban`, `state/queries/tasks`, `session-start`, `task-details`, and Agent Studio activity/workflow helpers.
