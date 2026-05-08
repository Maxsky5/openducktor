# packages/frontend/src/components/features/task-composer/

## Responsibility

Task creation/editing composer UI: issue-type selection, editor state, normalization, and draft-to-input translation.

## Design/Patterns

Local hooks and pure utils keep composer normalization close to the inputs and markdown editor state so the modal stays thin.

## Data & Control Flow

Draft sections are edited in local state, normalized into canonical task fields, and passed back as `TaskCreateInput`-style values.

## Integration Points

`task-details-form.tsx`, `task-document-editor.tsx`, `use-task-document-editor-state.ts`, `utils.ts`, `constants.ts`, `components/ui`, and the task state/query layer.
