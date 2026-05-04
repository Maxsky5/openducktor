# packages/frontend/src/pages/agents/composer-runtime/

## Responsibility
Focused internals for Agent Studio composer runtime state: model/catalog selection, UI option mapping, slash commands, file search, context-usage caching, draft/session repair, and selection handlers.

## Design Patterns
Expose the route-facing composer runtime hook directly from `use-agent-studio-composer-runtime.ts`. Do not keep compatibility facades when they preserve misleading names. Keep extracted modules explicit and concern-focused rather than adding a generic runtime framework.

## Data & Control Flow
The implementation resolves workspace/session context and delegates to these helpers/hooks. File search and slash commands keep using TanStack Query option builders from `state/queries` and must preserve repo-vs-active-session runtime boundaries.

## Integration Points
Uses shared selection helpers from `../agents-page-selection`, model preference helpers from `model-selection-preferences.ts`, and context usage helpers from `context-usage-resolution.ts`. Route orchestration should import `useAgentStudioComposerRuntime` directly.
