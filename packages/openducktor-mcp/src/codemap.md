# packages/openducktor-mcp/src/

## Responsibility

Implement the OpenDucktor MCP server entrypoint, task-store facade, host bridge client, store-context resolver, and response formatting helpers.

## Design Patterns

- Tool registration is data-driven from `ODT_TOOL_SCHEMAS` and `ODT_MCP_TOOL_NAMES`.
- Host discovery and validation are centralized before any tool executes.
- Tool results are always converted to JSON text plus structured content when possible.

## Data & Control Flow

- `index.ts` parses startup args, resolves context, constructs `OdtTaskStore`, registers tools, and starts stdio transport.
- `store-context.ts` resolves `hostUrl` from CLI/env/discovery, validates host readiness and workspace membership, and rejects legacy direct Beads/Dolt startup inputs.
- `odt-task-store.ts` parses workspace-scoped inputs and delegates to `host-bridge-client.ts`.
- `tool-results.ts` standardizes success/error envelopes returned by MCP tools.

## Integration Points

- Uses `@openducktor/contracts` for tool schemas, host bridge response schemas, and workspace/task payload validation.
- Uses `@modelcontextprotocol/sdk/server/mcp.js` and stdio transport for the MCP process.
- Connects to the Rust host bridge via HTTP endpoints discovered from the OpenDucktor runtime registry or `ODT_HOST_URL`.
