# packages/adapters-opencode-sdk/src/

## Responsibility
OpenCode-backed session, catalog, tool-authorization, runtime-connection, and event-processing implementation.

## Design Patterns
- One stateful adapter class wrapped around functional helpers.
- Validation/parsing helpers isolate brittle SDK payload shapes.
- Explicit caches keep sessions, metadata, and workflow-tool selection stable across stream updates.

## Data & Control Flow
`opencode-sdk-adapter.ts` drives create/resume/attach/fork/send/stop flows. `event-stream.ts` and `event-stream/*` normalize OpenCode stream events into session events, and `runtime-connection.ts` converts core runtime connections into SDK client inputs.

## Integration Points
- `catalog-and-mcp.ts`, `payload-mappers.ts`, `message-normalizers.ts`, `message-execution.ts`
- `workflow-tool-selection.ts`, `workflow-tool-permissions.ts`
- `client-factory.ts`, `request-errors.ts`, `file-reference-utils.ts`, `path-utils.ts`, `guards.ts`
