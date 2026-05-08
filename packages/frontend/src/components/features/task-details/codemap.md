# packages/frontend/src/components/features/task-details/

## Responsibility

Task detail sheet, markdown/doc viewers, document loading, document preview/copy affordances, delete/reset confirmations, and subtask/metadata presentation.

## Design/Patterns

Sheet-first UI with local controllers, view-model helpers, and document-load state; read-only sections stay separate from destructive actions and async load states.

## Data & Control Flow

Task/query state is assembled into sheet models, document content is loaded through state query helpers, and user actions flow back into task operations.

## Integration Points

`TaskDetailsSheetController`, `use-task-details-sheet-view-model.ts`, `task-details-sheet-model.ts`, `use-task-documents.ts`, `task-document-load-controller.ts`, markdown renderers, and the Kanban/Agent Studio pages.
