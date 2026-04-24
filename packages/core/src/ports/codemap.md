# packages/core/src/ports/

## Responsibility

Define the adapter-facing `AgentEnginePort` contract that encapsulates runtime registry, catalog, session lifecycle, and workspace inspection behavior.

## Design Patterns

- Interface-only boundary with input/output types separated from implementations.
- Session inputs carry `runtimeConnection` objects instead of raw endpoint strings.
- Workspace inspection stays within the same port family as agent session operations.

## Data & Control Flow

- `agent-engine.ts` defines start/resume/attach/fork/send/reply/stop and read operations for live sessions.
- Port inputs use session context, runtime connection, and request-scoped IDs to keep adapters honest.

## Integration Points

- Implemented by `packages/adapters-opencode-sdk`.
- Consumed by orchestration layers in the desktop app and any future agent runtime adapters.
