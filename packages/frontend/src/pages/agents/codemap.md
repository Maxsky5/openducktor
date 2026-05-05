# packages/frontend/src/pages/agents/

## Responsibility
Agent Studio route orchestration: task/session navigation, chat surface composition, chat composer page-adapter state, right-panel state, session creation, runtime readiness, active-session runtime hydration, and URL synchronization.

## Design Patterns
This folder is model-heavy. Shell/query-sync/right-panel/session-start/chat-composer hooks assemble page models, delegating reusable chat composer mechanics to `features/agent-chat-composer/`.

## Data & Control Flow
Route params and workspace state seed the shell model; session/task changes feed back into query params, session stores, runtime hydration, and right-panel refreshes.

## Integration Points
`shell/`, `query-sync/use-agent-studio-query-sync.ts`, `right-panel/use-agent-studio-right-panel.ts`, `session-start/use-agent-studio-session-start-flow.ts`, `chat-composer/use-agent-studio-chat-composer.ts`, `features/agent-chat-composer/`, `use-agent-studio-orchestration-controller.ts`, and `components/features/agents`.
