# apps/desktop/src/pages/agents/right-panel/

## Responsibility
Builds the Agent Studio right-panel model for documents or build-tools content, plus dev-server and diff/git controls.

## Design Patterns
Model-first helpers resolve panel availability, persistence, and open/close state; downstream components render the computed model only.

## Data & Control Flow
`use-agents-page-right-panel-model.ts` merges workspace/session/task/runtime data, resolves git panel target paths, and feeds the right-panel renderer.

## Integration Points
`components/features/agents/agent-studio-right-panel`, `agent-studio-build-tools`, `agent-studio-git-panel`, host open-in commands, and task/worktree queries.
