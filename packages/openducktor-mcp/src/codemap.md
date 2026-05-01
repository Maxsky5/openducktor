# packages/openducktor-mcp/src/

## Responsibility
OpenDucktor MCP entrypoint, task-store facade, host bridge client, store-context resolver, and response formatting helpers.

## Design Patterns
- Tool registration is data-driven from shared tool schemas.
- Host discovery and validation happen before tool execution.
- Tool results are normalized into MCP content plus JSON text.

## Data & Control Flow
`index.ts` parses startup args, resolves context, constructs `OdtTaskStore`, registers tools, and starts stdio transport. `lib.ts` re-exports the contract/tool surface, `store-context.ts` resolves `hostUrl`, validates workspace membership, and rejects legacy startup inputs. `odt-task-store.ts` delegates to `host-bridge-client.ts`; `tool-results.ts` standardizes success/error envelopes.

## Integration Points
- `@openducktor/contracts`
- `@modelcontextprotocol/sdk/server/mcp.js`
- Rust host bridge via runtime-registry discovery or `ODT_HOST_URL`
