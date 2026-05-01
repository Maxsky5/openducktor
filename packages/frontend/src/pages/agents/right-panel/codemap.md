# packages/frontend/src/pages/agents/right-panel/

## Responsibility
Builds the Agent Studio right-panel model for documents or build-tools content, composing snapshot-provided dev-server, diff, worktree, and git-control state.

## Design Patterns
Model-first helpers resolve panel availability, persistence, and open/close state; downstream components render the computed model only.

## Data & Control Flow
`use-agents-page-right-panel-model.ts` merges workspace/session/task/runtime inputs, consumes the build-tools worktree snapshot for worktree/Open In/dev-server/diff state, adds presentation-only git controls, and feeds the right-panel renderer.

## Integration Points
`components/features/agents/agent-studio-right-panel`, `agent-studio-build-tools`, `agent-studio-git-panel`, and host open-in commands. Task-worktree query and Open In fallback sequencing are owned by the build-tools snapshot module.
