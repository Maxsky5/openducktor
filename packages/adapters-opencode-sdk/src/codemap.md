# packages/adapters-opencode-sdk/src/

## Responsibility
OpenCode-backed session, catalog, approval-translation, runtime-connection, live-session-snapshots, history, and event-processing implementation.

## Design Patterns
- One stateful adapter class wrapped around functional helpers.
- Validation/parsing helpers isolate brittle SDK payload shapes.
- Explicit caches keep sessions, metadata, workflow-tool selection, live session snapshots, and runtime event subscriptions stable across stream updates.
- Shared session/runtime utilities keep runtime-route resolution and session input assembly fail-fast.

## Data & Control Flow
`opencode-sdk-adapter.ts` drives create/resume/attach/fork/send/stop flows and coordinates the per-session registry. `runtime-connection.ts` resolves repo/runtime references into OpenCode client inputs, `live-session-snapshots.ts` builds live session summaries from session/status/pending-input reads, `session-registry.ts` owns live session records plus shared runtime event transports, and `event-stream.ts`/`event-stream/*` normalize OpenCode stream events into session and message events. `approval-translation.ts`, `message-ops.ts`, `message-execution.ts`, and `diff-ops.ts` handle approval mapping, history, replies, prompt sends, and workspace inspection reads.

## Integration Points
- `catalog-and-mcp.ts`, `payload-mappers.ts`, `message-normalizers.ts`, `message-execution.ts`
- `workflow-tool-selection.ts`, `workflow-tool-permissions.ts`
- `client-factory.ts`, `request-errors.ts`, `file-reference-utils.ts`, `path-utils.ts`, `guards.ts`
