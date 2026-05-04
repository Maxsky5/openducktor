# packages/frontend/src/pages/agents/chat-composer/model-selection/

## Responsibility
Model/catalog selection for the Agent Studio chat composer: defaults, draft repair, active-session model repair, option mapping, selected runtime kind derivation, and select handlers.

## Design Patterns
Keep prompt input affordances and context-usage parsing out of this folder. Runtime terminology here should refer only to actual `RuntimeKind` values attached to model selections.

## Integration Points
Uses shared page selection helpers from `../../agents-page-selection` and feeds the route-facing `../use-agent-studio-chat-composer.ts` hook.
