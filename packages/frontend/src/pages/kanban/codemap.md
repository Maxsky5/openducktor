# packages/frontend/src/pages/kanban/

## Responsibility
Kanban route composition for task intake, board rendering, collapsed columns, task dialogs, approvals, resets, PR linking, human-review feedback, and session-start entry points.

## Design Patterns
Page-model hooks gather host/query data, then the page renders a single board shell plus focused modals/sheets driven by those models.

## Data & Control Flow
`use-kanban-page-models.ts` reads workspace/tasks/settings/session state, resolves per-task actions and column layout, and hands callbacks into the board and modal components.

## Integration Points
`components/features/kanban`, task-create/details/approval dialogs, git-conflict resolution, human-review feedback, and React Query task/settings loads.
