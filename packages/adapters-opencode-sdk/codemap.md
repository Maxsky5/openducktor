# packages/adapters-opencode-sdk/

## Responsibility

OpenCode SDK adapter that implements `AgentCatalogPort`, `AgentSessionPort`, and `AgentWorkspaceInspectionPort` against `@opencode-ai/sdk`.

## Design Patterns

- Fail-fast runtime translation at the adapter boundary.
- Session registry with event-stream replay and per-session caches.
- Role-scoped tool/permission synthesis from `@openducktor/core` policies.
- Adapter-local runtime-connection conversion keeps OpenCode client inputs separate from shared runtime summaries.

## Data & Control Flow

- `src/opencode-sdk-adapter.ts` orchestrates session lifecycle, message send, history/todo/diff/file-status reads, and live event subscription.
- `src/event-stream/*` normalizes global/session events into `AgentEvent` emissions.
- `src/catalog-and-mcp.ts`, `src/message-execution.ts`, `src/workflow-tool-selection.ts`, and runtime-connection helpers convert SDK responses into OpenDucktor catalogs and tool selections.

## Integration Points

- Consumes `@openducktor/contracts` runtime descriptors, MCP schemas, and workflow tool names.
- Consumes `@openducktor/core` agent ports, runtime-connection guards, and workflow policy helpers.
- Talks to OpenCode `session`, `tool`, `mcp`, `find`, `command`, and `config` APIs through `buildDefaultFactory()`.
