# packages/openducktor-mcp/

## Responsibility

MCP server package that exposes OpenDucktor workflow tools over stdio and forwards them to the desktop host bridge.

## Design Patterns

- Tool schema registry in `src/lib.ts` is shared between server registration and host-bridge responses.
- Store/context resolution fails fast on unsupported legacy env vars and missing host discovery.
- Tool execution is normalized into structured MCP results and errors.

## Data & Control Flow

- `src/index.ts` parses CLI args, resolves host/store context, registers tools on `McpServer`, and connects stdio transport.
- `src/odt-task-store.ts` validates tool input and calls the host bridge for task/workspace mutations.
- `src/host-bridge-client.ts` performs `/health` and `/invoke/*` HTTP calls to the Rust host bridge.

## Integration Points

- Consumes `@openducktor/contracts` tool schemas and response schemas.
- Uses `@modelcontextprotocol/sdk` for MCP server/stdio transport.
- Talks to the desktop host bridge discovered via `ODT_HOST_URL` or the MCP bridge registry.
