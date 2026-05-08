# packages/adapters-opencode-sdk/src/event-stream/message-events/

## Responsibility
Normalize OpenCode message.updated and message.part.* events into OpenDucktor assistant and user stream events, including completion, visibility, and subagent correlation.

## Design Patterns
- Split message handling by concern: `updated.ts` orchestrates whole-message updates, `parts.ts` handles part deltas/removals, and `assistant.ts`/`user.ts` own role-specific emission rules.
- Shared helpers keep message metadata, part lookup, and stop-signal detection in one place.
- User-message visibility and queued-state resolution stay separate from assistant emission and subagent correlation.

## Data & Control Flow
`updated.ts` ingests message.updated payloads, normalizes raw parts, stores message metadata, and dispatches to assistant/user handlers. `parts.ts` applies pending deltas, emits assistant deltas, and handles part removals. `assistant.ts` emits assistant parts/messages, tracks completion, and flushes deferred subagent emissions. `user.ts` reconciles queued user states and updates visible user messages via `user-display.ts`, `user-emitter.ts`, and `user-state.ts`. `helpers.ts` provides shared metadata/part utilities, and `subagent.ts` manages correlation keys for live subagent parts.

## Integration Points
- `../shared.ts` stream state and emit/session helpers
- `../schemas.ts` event payload readers
- `../../message-normalizers.ts` and `../../stream-part-mapper.ts`
- `@opencode-ai/sdk/v2/client` and `@openducktor/core`
