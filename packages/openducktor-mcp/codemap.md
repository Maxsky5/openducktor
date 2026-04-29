# packages/openducktor-mcp/

## Responsibility
MCP server package that exposes OpenDucktor workflow tools over stdio and forwards them to the desktop host bridge.

## Design Patterns
- Shared tool schema registry drives registration, response shaping, and workspace-scoped filtering.
- Store/context resolution fails fast on missing discovery, invalid workspace scope, or legacy inputs.
- Tool execution is normalized into structured MCP results and errors.

## Data & Control Flow
`src/index.ts` parses CLI args, resolves host/store context, registers tools, and connects stdio transport. `src/odt-task-store.ts` validates tool input and calls the host bridge; `src/host-bridge-client.ts` performs health/invoke HTTP calls; `src/store-context.ts` discovers and validates bridge context.

## Integration Points
- `@openducktor/contracts`
- `@modelcontextprotocol/sdk`
- Desktop host bridge discovered via runtime registry or `ODT_HOST_URL`
