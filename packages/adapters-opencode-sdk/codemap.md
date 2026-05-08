# packages/adapters-opencode-sdk/

## Responsibility
OpenCode SDK adapter for `AgentCatalogPort`, `AgentSessionPort`, `AgentWorkspaceInspectionPort`, and runtime registry reads.

## Design Patterns
- Fail-fast translation at the adapter boundary.
- Session registry plus live-session snapshots and event-stream replay keeps live session state, history hydration, and subagent correlation aligned.
- Event-stream message handling is split into `src/event-stream/message-events/` for assistant/user part normalization, while `session-events.ts` keeps lifecycle and approval routing separate.
- Runtime descriptors are resolved locally and converted into OpenCode client inputs at the boundary.
- Approval translation maps OpenCode approval prompts to shared agent approval requests.
- Message, diff, and file-status operations stay adapter-local and reuse shared normalization helpers.

## Data & Control Flow
`src/opencode-sdk-adapter.ts` drives session lifecycle, session registry updates, and workspace reads. `src/runtime-connection.ts` resolves repo/runtime references into OpenCode client inputs, `src/live-session-snapshots.ts` hydrates live sessions and pending approvals/questions, `src/session-registry.ts` owns live session state and runtime event transport sharing, and `src/event-stream/*` maps OpenCode session/global events into `AgentEvent` emissions. Message-specific behavior now lives under `src/event-stream/message-events/` (`updated.ts`, `parts.ts`, `assistant.ts`, `user.ts`, `user-display.ts`, `user-emitter.ts`, `user-state.ts`, `subagent.ts`, `helpers.ts`) and is dispatched through `message-events.ts`. `src/approval-translation.ts`, `src/message-ops.ts`, `src/message-execution.ts`, and `src/diff-ops.ts` handle approval mapping, history, pending input replies, prompt sends, and diff/file-status reads.

## Integration Points
- `@openducktor/contracts` runtime descriptors, run/session schemas, and workflow tool names
- `@openducktor/core` port, runtime-connection, and prompt/workflow types
- `@opencode-ai/sdk` session/tool/mcp/find/command/config APIs
