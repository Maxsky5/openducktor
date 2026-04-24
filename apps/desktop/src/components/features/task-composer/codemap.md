# apps/desktop/src/components/features/task-composer/

## Responsibility
Task creation/editing composer UI: issue-type selection, editor state, normalization, and draft-to-input translation.

## Design Patterns
This folder keeps the composer state machine close to the inputs/normalizers it needs so the modal can stay thin.

## Data & Control Flow
Draft sections are edited in local state, normalized into canonical task fields, and passed back as `TaskCreateInput`-style values.

## Integration Points
`task-create/`, `task-details/` editing surfaces, `components/ui`, and the task state/query layer.
