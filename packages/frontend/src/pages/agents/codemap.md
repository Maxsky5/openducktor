# packages/frontend/src/pages/agents/

## Responsibility

Agent Studio route orchestration: shell composition, query sync, session/task selection, header/right-panel/page models, session creation, runtime readiness, active-session runtime hydration, and URL synchronization.

## Design/Patterns

This folder is model-heavy. Shell, session-start, session-actions, right-panel, task-tabs, chat-settings, repo-settings, and session-action helpers assemble page models, delegating reusable mechanics to feature/component folders.

## Data & Control Flow

Route params and workspace state seed the shell model; session/task changes feed back into query params, session stores, runtime hydration, header quick actions/history/workflow rail, and right-panel refreshes.

## Integration Points

`shell/`, `session-start/`, `session-actions/`, `query-sync/`, `right-panel/`, `use-agent-studio-page-models.ts`, `use-agent-studio-page-submodels.ts`, `use-agent-studio-page-model-builders.ts`, `use-agent-studio-session-action-helpers.ts`, and `components/features/agents`.
