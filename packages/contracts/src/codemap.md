# packages/contracts/src/

## Responsibility
Public schema surface for runtime descriptors, task/workflow records, MCP tool payloads, host-bridge responses, browser runtime config, and session/run config.

## Design Patterns
- Zod-first contract modeling with strict object shapes and explicit refinements.
- Shared literal unions prevent drift between validation and types.
- Descriptor modules derive runtime/tool constants from canonical name lists.

## Data & Control Flow
`agent-runtime-schemas.ts` and `agent-workflow-schemas.ts` model runtime roles, capabilities, and transport routes. `task-schemas.ts`, `odt-mcp-schemas.ts`, and `run-schemas.ts` model task, MCP, and session/run payloads. `runtime-descriptors.ts` assembles the OpenCode runtime descriptor from those rules.

## Integration Points
- Re-exported by `src/index.ts`
- Consumed by `apps/desktop/src-tauri`, `packages/adapters-*`, `packages/openducktor-mcp`, and `packages/openducktor-web`
