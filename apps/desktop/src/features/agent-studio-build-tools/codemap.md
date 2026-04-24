# apps/desktop/src/features/agent-studio-build-tools/

## Responsibility
Build-tools diff/dev-server read models and bootstrap helpers for Agent Studio’s right panel.

## Design Patterns
The folder separates bootstrap/setup from read models so the panel can derive diff, worktree, and dev-server state without duplicating host calls.

## Data & Control Flow
Page models request build-tool snapshots, then render diff and terminal state from those snapshots while preserving task/worktree context.

## Integration Points
`components/features/agents/agent-studio-git-panel`, `pages/agents/right-panel`, and runtime/worktree queries.
