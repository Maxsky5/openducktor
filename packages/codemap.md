# packages/

## Responsibility

Workspace-level shared code for OpenDucktor package boundaries: shared frontend app, local browser runner, contract schemas, core domain ports/services, and host/runtime adapters.

## Design Patterns

- Hexagonal split between `packages/contracts`, `packages/core`, and adapter packages.
- Shell split between `packages/frontend` shared UI and shell-specific adapters in `apps/desktop/src` / `packages/openducktor-web/src`.
- Contracts-first data modeling; TS runtime validation via `zod` schemas.
- Adapters translate host/runtime APIs into core abstractions without leaking infra details upward.

## Data & Control Flow

- `packages/contracts/src/*` defines shared payloads and descriptors.
- `packages/core/src/*` defines orchestration ports, workflow helpers, and role policy logic.
- `packages/adapters-*` bridge Tauri/OpenCode/MCP/runtime APIs into the core abstractions.
- `packages/frontend/src/*` renders the shared app through an explicit `ShellBridge` instead of direct Tauri/browser imports.
- `packages/openducktor-web/src/*` starts the Rust web host, serves the frontend through Vite, and owns the browser-local HTTP/SSE transport.

## Integration Points

- `@openducktor/contracts` is the source of truth for IPC/runtime/task payloads.
- `@openducktor/core` exposes workflow and agent-engine ports used by adapters.
- `@openducktor/frontend` is the shared React app consumed by the desktop and local web shells.
- `@openducktor/web` is the public launcher package for `bunx @openducktor/web`.
- `@openducktor/mcp` publishes ODT workflow tools over MCP for the desktop host.
