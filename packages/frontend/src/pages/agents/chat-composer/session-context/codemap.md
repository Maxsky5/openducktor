# packages/frontend/src/pages/agents/chat-composer/session-context/

## Responsibility
Active-session context extraction for the Agent Studio chat composer: session id, repo path, runtime kind, working directory, catalog loading state, live context usage, and message history.

## Design Patterns
Keep this folder about session-derived composer inputs only. Do not place model-selection preference, prompt-input, or context-usage calculation logic here.

## Integration Points
Consumed by `../use-agent-studio-chat-composer.ts` before model-selection, prompt-input, and context-usage helpers run.
