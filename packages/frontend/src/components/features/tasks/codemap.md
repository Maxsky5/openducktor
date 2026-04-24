# apps/desktop/src/components/features/tasks/

## Responsibility
Task selection affordances and small task identity badges used across board, sheet, and workspace views.

## Design Patterns
Tiny presentational helpers with minimal logic; they rely on upstream task models for status, title, and label presentation.

## Data & Control Flow
Task lists or single task summaries are passed in from page/feature models and rendered as buttons, badges, or selectors.

## Integration Points
Kanban boards, task details, task composer flows, and `state` task-read models.
