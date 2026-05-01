# packages/adapters-opencode-sdk/

## Responsibility
OpenCode SDK adapter for `AgentCatalogPort`, `AgentSessionPort`, `AgentWorkspaceInspectionPort`, and runtime registry reads.

## Design Patterns
- Fail-fast translation at the adapter boundary.
- Session registry plus event-stream replay keeps live session state, history hydration, and subagent correlation aligned.
- Runtime descriptors are resolved locally and converted into OpenCode client inputs at the boundary.
- Message, diff, and file-status operations stay adapter-local and reuse shared normalization helpers.

## Data & Control Flow
`src/opencode-sdk-adapter.ts` drives session lifecycle, session registry updates, and workspace reads. `src/runtime-connection.ts` resolves repo/runtime references into OpenCode client inputs, `src/session-registry.ts` owns live session state and runtime event transport sharing, and `src/event-stream/*` maps OpenCode session/global events into `AgentEvent` emissions. `src/message-ops.ts`, `src/message-execution.ts`, and `src/diff-ops.ts` handle history, pending input replies, prompt sends, and diff/file-status reads.

## Integration Points
- `@openducktor/contracts` runtime descriptors, run/session schemas, and workflow tool names
- `@openducktor/core` port, runtime-connection, and prompt/workflow types
- `@opencode-ai/sdk` session/tool/mcp/find/command/config APIs
