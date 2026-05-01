# packages/frontend/src/pages/agents/query-sync/

## Responsibility
Keeps Agent Studio URL state, repository navigation persistence, runtime selection, and session/task selection synchronized with the browser location.

## Design Patterns
Navigation is normalized through small URL-state helpers so task/session/role/launch changes remain deterministic across reloads and repo switches.

## Data & Control Flow
`use-agent-studio-query-sync.ts` delegates to `use-navigation-url-sync.ts` and `use-repo-navigation-persistence.ts`, then exposes the resolved query fields, runtime selection, and update function to shell code.

## Integration Points
`react-router-dom` search params, `agent-studio-navigation.ts`, and the Agent Studio shell model that consumes the synchronized values.
