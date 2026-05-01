# packages/

## Responsibility
Workspace-level shared code: shared frontend, contracts, core domain services, runtime adapters, browser launcher, and MCP tooling.

## Design Patterns
- Contracts-first boundaries keep runtime descriptors, config schemas, and host payloads stable before adapters consume them.
- Hexagonal core keeps runtime/session logic behind ports while adapters translate host APIs at the edge.
- Frontend, browser, and MCP packages own their own UI, launcher, and bridge surfaces instead of sharing shell internals.

## Data & Control Flow
`packages/frontend` owns shell-neutral UI composition. `packages/contracts` defines schemas and descriptors; `packages/core` defines ports and orchestration rules; `packages/adapters-*` map host/runtime APIs into those ports; `packages/openducktor-web` and `packages/openducktor-mcp` handle launcher and host-bridge execution paths.

## Integration Points
- `@openducktor/contracts`
- `@openducktor/core`
- `@openducktor/frontend`
- `@openducktor/web`
- `@openducktor/mcp`
