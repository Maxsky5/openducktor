# packages/adapters-opencode-sdk/

## Responsibility
OpenCode SDK adapter for `AgentCatalogPort`, `AgentSessionPort`, and `AgentWorkspaceInspectionPort`.

## Design Patterns
- Fail-fast translation at the adapter boundary.
- Session registry plus event-stream replay keeps live session state and historical rehydration aligned.
- Runtime connections are converted locally so shared core types stay transport-agnostic.

## Data & Control Flow
`src/opencode-sdk-adapter.ts` drives session lifecycle, workspace reads, and event subscription. `src/event-stream/*` turns OpenCode session/global events into `AgentEvent` emissions, while catalog/tool helpers translate contract/runtime data into OpenCode client calls.

## Integration Points
- `@openducktor/contracts` runtime descriptors, run/session schemas, and workflow tool names
- `@openducktor/core` port and runtime-connection types
- `@opencode-ai/sdk` session/tool/mcp/find/command/config APIs
