# packages/frontend/src/pages/agents/chat-composer/

## Responsibility
Focused internals for Agent Studio chat composer state: model/catalog selection, UI option mapping, prompt-input affordances, active-session context usage, draft/session repair, and selection actions.

## Design Patterns
Expose the route-facing chat composer hook directly from `use-agent-studio-chat-composer.ts`. Do not keep compatibility facades when they preserve misleading names. Split files by responsibility instead of grouping unrelated composer concerns in one folder.

## Data & Control Flow
The implementation resolves workspace/session context and delegates to `session-context/`, `model-selection/`, `prompt-input/`, and `context-usage/`. File search and slash commands keep using TanStack Query option builders from `state/queries` and must preserve repo-vs-active-session runtime boundaries.

## Integration Points
Uses shared selection helpers from `../agents-page-selection`. Route orchestration should import `useAgentStudioChatComposer` directly.
