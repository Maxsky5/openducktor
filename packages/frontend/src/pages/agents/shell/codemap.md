# packages/frontend/src/pages/agents/shell/

## Responsibility

Top-level Agent Studio shell model and layout glue for tabs, header quick actions, session history, workflow rail, chat, right panel, task details, runtime hydration, and session modals.

## Design/Patterns

The shell hook composes route state, orchestration, right-panel, readiness, and session-start hooks into one renderable model.

## Data & Control Flow

Query params, active workspace, runtime definitions, task/session summaries, and repo readiness all flow into the shell model; the shell then forwards actions back into state operations.

## Integration Points

`use-agents-page-shell-model.tsx`, `agents-page.tsx`, `agents-page-layout.tsx`, `use-forwarded-worktree-refresh.ts`, `TaskDetailsSheetController`, `SessionStartModal`, `AgentStudioRightPanel`, and `HumanReviewFeedbackModal`.
