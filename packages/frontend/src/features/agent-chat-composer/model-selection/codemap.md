# packages/frontend/src/features/agent-chat-composer/model-selection/

## Responsibility
Reusable model/catalog selection for agent chat composers: defaults, draft repair, active-session model repair, option mapping, selected runtime kind derivation, and select handlers.

## Design Patterns
Keep prompt input affordances and context-usage parsing out of this folder. Runtime terminology here should refer only to actual `RuntimeKind` values attached to model selections.

## Integration Points
Uses shared session-start selection helpers and feeds page adapters such as `pages/agents/chat-composer/use-agent-studio-chat-composer.ts`.
