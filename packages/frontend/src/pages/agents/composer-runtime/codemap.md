# packages/frontend/src/pages/agents/composer-runtime/

## Responsibility
Focused internals for Agent Studio composer runtime state: model/catalog selection, UI option mapping, slash commands, file search, context-usage caching, draft/session repair, and selection handlers.

## Design Patterns
Keep `../use-agent-studio-model-selection.ts` as the public compatibility facade consumed by route orchestration. Keep extracted modules explicit and concern-focused rather than adding a generic runtime framework.

## Data & Control Flow
The implementation resolves workspace/session context and delegates to these helpers/hooks. File search and slash commands keep using TanStack Query option builders from `state/queries` and must preserve repo-vs-active-session runtime boundaries.

## Integration Points
Uses shared selection helpers from `../agents-page-selection` and local model/context helpers from `model-selection-model.ts`. Public consumers should import the facade unless they are focused tests for these internals.
