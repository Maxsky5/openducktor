# packages/frontend/src/components/features/task-details/

## Responsibility
Task detail sheet, markdown/doc viewers, document loading, document preview/copy affordances, delete/reset confirmations, and subtask/metadata presentation.

## Design Patterns
Sheet-first UI with local controllers and model builders; read-only document sections stay separate from destructive actions, preview dialogs, and async load states.

## Data & Control Flow
Task/query state is assembled into sheet models, document content is loaded through state query helpers, and user actions flow back into task operations.

## Integration Points
`TaskDetailsSheetController`, task document queries, reset/delete dialogs, markdown renderers, and the Kanban/Agent Studio pages.
