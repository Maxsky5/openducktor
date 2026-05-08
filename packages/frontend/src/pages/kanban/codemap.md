# packages/frontend/src/pages/kanban/

## Responsibility

Kanban route composition for task intake, board rendering, task dialogs, approvals, resets, PR linking, human-review feedback, and session-start entry points.

## Design/Patterns

Page-model hooks gather host/query data, then the page renders a board shell plus focused modals and flows driven by those models.

## Data & Control Flow

`use-kanban-page-models.ts` reads workspace/tasks/settings/session state, resolves per-task actions and column layout, and hands callbacks into the board and modal components.

## Integration Points

`use-kanban-page-models.ts`, `use-kanban-board-model.ts`, `use-task-approval-flow.ts`, `use-task-reset-flow.ts`, `use-kanban-session-start-flow.ts`, `components/features/kanban`, task dialogs/modals, git-conflict resolution, and human-review feedback.
