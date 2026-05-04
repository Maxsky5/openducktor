# packages/frontend/src/pages/agents/model-selection/

## Responsibility
Focused internals for the Agent Studio model-selection facade hook: selection resolution, UI option mapping, slash commands, file search, context-usage caching, draft/session repair, and selection handlers.

## Design Patterns
Keep `../use-agent-studio-model-selection.ts` as the public compatibility facade consumed by route orchestration. Keep extracted modules explicit and concern-focused rather than adding a generic model-selection framework.

## Data & Control Flow
The facade resolves workspace/session context and delegates to these helpers/hooks. File search and slash commands keep using TanStack Query option builders from `state/queries` and must preserve repo-vs-active-session runtime boundaries.

## Integration Points
Uses shared selection helpers from `../agents-page-selection` and model/context helpers from `../use-agent-studio-model-selection-model`. Public consumers should import the facade unless they are focused tests for these internals.
