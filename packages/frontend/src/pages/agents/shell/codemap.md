# packages/frontend/src/pages/agents/shell/

## Responsibility
Top-level Agent Studio shell model and layout glue for tabs, chat header, right panel, task details, runtime hydration, and session modals.

## Design Patterns
The shell hook composes multiple page-model hooks (`useAgentStudioQuerySync`, orchestration, right-panel, readiness, session-start) into one renderable model.

## Data & Control Flow
Query params, active workspace, runtime definitions, task/session summaries, and repo readiness all flow into the shell model; the shell then forwards actions back into state operations.

## Integration Points
`agents-page.tsx`, `agents-page-layout.tsx`, `use-forwarded-worktree-refresh.ts`, `TaskDetailsSheetController`, `SessionStartModal`, and right-panel/build-tool components.
