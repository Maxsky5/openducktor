# packages/frontend/src/components/features/agents/

## Responsibility

Agent feature UI: reusable chat surface, Agent Studio header submodels, session history, quick actions, workflow rail, session tabs, workspace sidebar, dev-server panel, git panel, right-panel composition, runtime attachment retry handling, and session-start modal entry points.

## Design/Patterns

Model/view separation stays strong here. Hooks and helper modules build structured models; renderers stay mostly presentational.

## Data & Control Flow

Session/task/runtime data from `state/`, reusable chat-composer features, and page models flow into chat, header, and panel models, then callbacks route actions back into orchestrator operations.

## Integration Points

`agent-chat/`, `agent-studio-header*`, `agent-studio-git-panel/`, `agent-studio-right-panel`, `agent-studio-dev-server-panel`, `agent-studio-workspace-sidebar`, and `SessionStartModal`.
