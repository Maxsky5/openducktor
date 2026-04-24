# packages/adapters-opencode-sdk/src/event-stream/

## Responsibility

Normalize OpenCode event streams into OpenDucktor session events, including message deltas, session status, permissions, questions, todos, and subagent correlation.

## Design Patterns

- Event routing by payload type with dedicated handlers per message/session concern.
- Stateful correlation maps for assistant parts, child sessions, and pending subagent emissions.
- Strict relevance filtering to avoid cross-session event bleed.

## Data & Control Flow

- `shared.ts` keeps per-session stream state and low-level helpers.
- `message-events.ts` maps OpenCode message/delta events into `assistant_part`, `user_message`, and queued-state updates.
- `session-events.ts` maps session lifecycle/status/todo/permission/question events into `AgentEvent` emissions.
- `schemas.ts` parses fragile OpenCode payload shapes before handlers mutate session state.

## Integration Points

- Consumed by `src/event-stream.ts` and `src/opencode-sdk-adapter.ts`.
- Relies on `@opencode-ai/sdk/v2/client` event and part types.
- Emits core `AgentEvent` values defined by `@openducktor/core`.
