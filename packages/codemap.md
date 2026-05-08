# packages/

## Responsibility
Workspace-level shared code: shared frontend, contracts, core domain services, runtime adapters, browser launcher, and MCP tooling.

## Design Patterns
- Contracts-first boundaries keep runtime descriptors, config/session schemas, slash-command catalogs, and host payloads stable before adapters consume them.
- Hexagonal core keeps runtime/session/approval-policy logic behind ports while adapters translate host APIs at the edge.
- Frontend, browser, and MCP packages own their own UI, launcher, and bridge surfaces instead of sharing shell internals.
- Adapter event-stream handling is split so OpenCode message normalization lives under `packages/adapters-opencode-sdk/src/event-stream/message-events/` while session-level routing stays in `session-events.ts`.

## Data & Control Flow
`packages/frontend` owns shell-neutral UI composition. `packages/contracts` defines runtime, config/settings, session, run, and workflow schemas plus descriptors; `packages/core` defines ports and orchestration rules; `packages/adapters-opencode-sdk` maps OpenCode session/global streams into adapter events with `event-stream/message-events/` decomposition; `packages/adapters-tauri-host` exposes the typed host IPC surface; `packages/openducktor-web` and `packages/openducktor-mcp` handle browser-shell and host-bridge execution paths with CLI/bin package metadata.

## Integration Points
- `@openducktor/contracts`
- `@openducktor/core`
- `@openducktor/frontend`
- `@openducktor/web`
- `@openducktor/mcp`
