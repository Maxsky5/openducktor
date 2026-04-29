# apps/desktop/src-tauri/crates/host-application/src/app_service/opencode_runtime/

## Responsibility
OpenCode runtime process management and MCP configuration generation.

## Design
The module splits MCP config building, process lifecycle control, process registry tracking, and startup readiness polling. Process inputs are derived from the active runtime connection and host-managed route data.

## Flow
`AppService` builds an OpenCode config, spawns or reuses the process, waits for readiness, and records/cleans up process state through the registry.

## Integration
Uses `host_infra_system` path/process helpers and `host_domain::RuntimeRoute` / runtime readiness types.
