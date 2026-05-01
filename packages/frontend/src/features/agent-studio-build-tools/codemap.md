# packages/frontend/src/features/agent-studio-build-tools/

## Responsibility
Build-tools worktree snapshot, diff/dev-server read models, refresh observers, and bootstrap helpers for Agent Studio’s right panel.

## Design Patterns
The folder separates bootstrap/setup from the canonical worktree snapshot read model so the panel can consume diff, worktree, Open In, and dev-server state without duplicating host calls or worktree fallback rules.

## Data & Control Flow
Page models request the selected build-tools worktree snapshot, then render diff and terminal state from that snapshot while preserving task/worktree context. Stable task-worktree reads stay query-owned; worktree-mode failures remain visible instead of falling back to the repo root.

## Integration Points
`components/features/agents/agent-studio-git-panel`, `pages/agents/right-panel`, and runtime/worktree queries.
