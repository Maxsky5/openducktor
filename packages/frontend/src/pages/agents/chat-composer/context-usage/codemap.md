# packages/frontend/src/pages/agents/chat-composer/context-usage/

## Responsibility
Context-usage derivation and caching for the Agent Studio chat composer from live active-session context usage, session messages, and selected model metadata.

## Design Patterns
Keep context window/output-limit resolution pure and separately tested. The hook owns React memoization and cache invalidation; pure helpers own message scanning and descriptor lookup.

## Integration Points
Consumes active-session context from `session-context/` via `../use-agent-studio-chat-composer.ts` and model descriptors from the active session catalog.
