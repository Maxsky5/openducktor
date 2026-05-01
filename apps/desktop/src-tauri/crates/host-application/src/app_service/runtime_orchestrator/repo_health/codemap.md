# apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/repo_health/

## Responsibility
Derive repo runtime health and startup status from live runtime, MCP, and host-side state.

## Design
`mod.rs` coordinates the workflow, `mcp.rs` handles MCP status and tool ids, `status.rs` maps startup stages to health, and `flights.rs` models health-flight state. The health path depends on the runtime registry plus the MCP bridge process/registry state and does not mask failures with a fallback runtime.

## Flow
The orchestrator inspects host startup status, probes runtime health and MCP connectivity, and returns a consolidated `RepoRuntimeHealthCheck` or `RepoRuntimeStartupStatus`.

## Integration
Uses runtime registry adapters, `host_domain` runtime health types, and cached runtime-session status probes.
