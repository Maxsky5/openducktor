# packages/core/src/ports/

## Responsibility
Define the adapter-facing `AgentEnginePort` contract for runtime registry, catalog, session lifecycle, and workspace inspection behavior.

## Design Patterns
- Interface-only boundary with separated input/output types.
- Session inputs carry `runtimeConnection` objects instead of raw endpoint strings.
- Workspace inspection stays in the same port family as agent sessions.

## Data & Control Flow
`agent-engine.ts` defines start/resume/attach/fork/send/reply/stop and workspace read operations. Port inputs use session context, runtime connection, and request-scoped IDs to keep adapters honest.

## Integration Points
- Implemented by `packages/adapters-opencode-sdk`
- Consumed by orchestration layers in the desktop app
