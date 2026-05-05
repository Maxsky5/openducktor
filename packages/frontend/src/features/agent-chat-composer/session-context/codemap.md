# packages/frontend/src/features/agent-chat-composer/session-context/

## Responsibility

Reusable active-session context extraction for agent chat composers: session id, repo path, runtime kind, working directory, catalog loading state, live context usage, and message history.

## Design/Patterns

Keep this folder about session-derived composer inputs only. Do not place model-selection preference, prompt-input, or context-usage calculation logic here.

## Flow

Page-level composer adapters build this session context before model-selection, prompt-input, and context-usage helpers run.

## Integration

Consumed by Agent Studio composer adapters and downstream reusable composer helpers.
