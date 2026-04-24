# packages/contracts/src/

## Responsibility

Define the public schema surface for OpenDucktor runtime descriptors, task/workflow records, MCP tool payloads, git/session config, and supporting enums.

## Design Patterns

- Zod-first contract modeling with strict object shapes and explicit refinements.
- Shared literal arrays (`agentRoleValues`, `taskStatusSchema`, `runtimeSupportedScopeValues`) prevent drift between validation and types.
- Descriptor modules build derived constants from canonical tool-name lists.

## Data & Control Flow

- `agent-workflow-schemas.ts` and `agent-runtime-schemas.ts` model runtime roles, capabilities, scenarios, and transport routes.
- `task-schemas.ts` and `odt-mcp-schemas.ts` model task cards and the MCP tool inputs/outputs.
- `runtime-descriptors.ts` assembles the OpenCode runtime descriptor from canonical tool names and capability rules.

## Integration Points

- Re-exported by `src/index.ts` for all workspace consumers.
- Drives host-side parsing in `apps/desktop/src-tauri` and adapter-side request validation in `packages/adapters-*`.
