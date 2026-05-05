# packages/frontend/src/features/agent-chat-composer/

## Responsibility
Reusable agent chat composer state helpers: session-derived composer context, model/catalog selection, prompt-input affordances, file search routing, slash command merging, and context-usage derivation.

## Design Patterns
Keep this feature independent from route modules. Pages supply workspace/session/settings/query callbacks; these helpers resolve composer state without importing from `pages/*`.

## Data & Control Flow
Page adapters pass active session, repo, runtime, and model catalog inputs into the feature helpers. The helpers return normalized selections, UI option models, prompt-input capability state, and query functions consumed by reusable chat UI.

## Integration Points
Consumed by Agent Studio page adapters and `components/features/agents/agent-chat`. Uses shared session-start selection utilities and TanStack Query option builders from `state/queries`.
