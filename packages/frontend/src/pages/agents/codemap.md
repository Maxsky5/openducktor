# packages/frontend/src/pages/agents/

## Responsibility
Agent Studio route orchestration: task/session navigation, chat surface composition, runtime selection, right-panel state, session creation, runtime readiness, and URL synchronization.

## Design Patterns
This folder is model-heavy. Shell/query-sync/right-panel/session-start hooks assemble page models that are then rendered by the agents shell page.

## Data & Control Flow
Route params and workspace state seed the shell model; session/task changes feed back into query params, session stores, route-only hydration, and right-panel refreshes.

## Integration Points
`shell/`, `query-sync/`, `right-panel/`, `session-start/`, `use-agent-studio-*` orchestration hooks, and `components/features/agents`.
