# apps/desktop/src/components/features/agents/

## Responsibility
Agent Studio feature UI: chat surface, session tabs, workspace sidebar, dev-server panel, git panel, right-panel composition, and session-start modal entry points.

## Design Patterns
Heavy model/view separation. Hooks and `*.types.ts` files build structured models; renderers stay mostly presentational.

## Data & Control Flow
Session/task/runtime data from `state/` and page models flows into chat and panel models, then callbacks route actions back into orchestrator operations.

## Integration Points
`agent-chat/`, `agent-studio-git-panel/`, `agent-studio-right-panel`, `agent-studio-dev-server-panel`, `agent-studio-workspace-sidebar`, and `SessionStartModal`.
