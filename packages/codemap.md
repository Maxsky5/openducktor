# packages/

## Responsibility

Workspace-level shared code for OpenDucktor package boundaries: contract schemas, core domain ports/services, and host/runtime adapters.

## Design Patterns

- Hexagonal split between `packages/contracts`, `packages/core`, and adapter packages.
- Contracts-first data modeling; TS runtime validation via `zod` schemas.
- Adapters translate host/runtime APIs into core abstractions without leaking infra details upward.

## Data & Control Flow

- `packages/contracts/src/*` defines shared payloads and descriptors.
- `packages/core/src/*` defines orchestration ports, workflow helpers, and role policy logic.
- `packages/adapters-*` bridge Tauri/OpenCode/MCP/runtime APIs into the core abstractions.

## Integration Points

- `@openducktor/contracts` is the source of truth for IPC/runtime/task payloads.
- `@openducktor/core` exposes workflow and agent-engine ports used by adapters.
- `@openducktor/mcp` publishes ODT workflow tools over MCP for the desktop host.
