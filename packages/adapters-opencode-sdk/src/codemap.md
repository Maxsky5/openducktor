# packages/adapters-opencode-sdk/src/

## Responsibility

Adapter implementation for OpenCode-backed agent sessions, catalogs, tool authorization, message encoding, runtime-connection translation, and event processing.

## Design Patterns

- Small functional helpers wrapped by a single stateful `OpencodeSdkAdapter` class.
- Shared validation/parsing utilities isolate brittle SDK payload shapes.
- Explicit cache objects for sessions, metadata, and workflow tool selection.
- Adapter-local runtime connection helpers keep host/runtime details out of shared core types.

## Data & Control Flow

- `opencode-sdk-adapter.ts` drives create/resume/attach/fork/send/stop flows and delegates to helper modules.
- `event-stream.ts` and `event-stream/*` turn OpenCode global events into session-scoped `AgentEvent` updates.
- `catalog-and-mcp.ts`, `payload-mappers.ts`, `message-normalizers.ts`, `message-execution.ts`, and `runtime-connection.ts` transform SDK payloads into core contract shapes.

## Integration Points

- `runtime-connection.ts` converts core runtime connections into OpenCode client inputs.
- `workflow-tool-selection.ts` and `workflow-tool-permissions.ts` enforce OpenDucktor role policy against OpenCode MCP/tool ids.
- `client-factory.ts`, `request-errors.ts`, `file-reference-utils.ts`, `path-utils.ts`, and `guards.ts` keep SDK access typed and fail-fast.
