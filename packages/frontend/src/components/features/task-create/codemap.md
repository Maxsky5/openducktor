# packages/frontend/src/components/features/task-create/

## Responsibility
Task creation modal, discard confirmation, and controller/model glue for adding new work items.

## Design Patterns
Modal controller + model split keeps the form state, validation, and discard logic isolated from the rendered dialog.

## Data & Control Flow
User edits build a draft model, the controller validates whether the form is dirty, and submission flows into task creation operations.

## Integration Points
Kanban page modals, `components/ui` dialogs/forms, and task state/query mutations.
