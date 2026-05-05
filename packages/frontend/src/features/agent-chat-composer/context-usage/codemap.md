# packages/frontend/src/features/agent-chat-composer/context-usage/

## Responsibility
Reusable context-usage derivation and caching for agent chat composers from live active-session context usage, session messages, and selected model metadata.

## Design Patterns
Keep context window/output-limit resolution pure and separately tested. The hook owns React memoization and cache invalidation; pure helpers own message scanning and descriptor lookup.

## Integration Points
Consumes active-session context from `session-context/` through page adapters and model descriptors from the active session catalog.
