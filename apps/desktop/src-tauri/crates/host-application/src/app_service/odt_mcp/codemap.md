# apps/desktop/src-tauri/crates/host-application/src/app_service/odt_mcp/

## Responsibility
Bridge between MCP tool calls and application-service task operations.

## Design
Mapping, task-resolution, and serde types are separated so tool names and payload shapes stay stable while implementation details move underneath.

## Flow
Incoming ODT tool payloads resolve a task/workspace reference, call the relevant task workflow method, and serialize the result back to the MCP caller.

## Integration
Implements the workflow tool contract used by the MCP server and the browser/desktop host layers.
