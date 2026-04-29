# packages/adapters-opencode-sdk/src/event-stream/

## Responsibility
Normalize OpenCode event streams into OpenDucktor session events, including message deltas, session status, permissions, questions, todos, and subagent correlation.

## Design Patterns
- Dedicated handlers per event family with correlation maps for session-local state.
- Strict filtering keeps stream events scoped to the active session/thread.

## Data & Control Flow
`shared.ts` holds per-session stream state, `message-events.ts` maps message/delta updates, `session-events.ts` maps lifecycle and approval events, and `schemas.ts` validates fragile OpenCode payload shapes before mutation.

## Integration Points
- `src/event-stream.ts` and `src/opencode-sdk-adapter.ts`
- `@opencode-ai/sdk/v2/client`
- Core `AgentEvent` values from `@openducktor/core`
