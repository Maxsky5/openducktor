# apps/desktop/src-tauri/crates/host-application/src/app_service/

## Responsibility
Core application-service implementation for runtimes, tasks, workflows, workspace policy, and host coordination.

## Design
The module tree splits by concern: build orchestration, runtime orchestration/registry, OpenCode runtime process lifecycle, MCP bridge process/registry, task workflow/document service, dev-server management, startup metrics, and policy enforcement.

## Flow
`AppService` receives a command request, resolves repo/runtime state, executes the appropriate sub-service, and returns typed `host_domain` results or actionable errors.

## Integration
Consumes `host_domain` models and ports, `host_infra_system` config/process/git helpers, and `host_infra_beads::BeadsTaskStore` for task persistence.
