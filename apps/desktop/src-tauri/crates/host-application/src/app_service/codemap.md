# apps/desktop/src-tauri/crates/host-application/src/app_service/

## Responsibility
Core application-service implementation for runtimes, tasks, workflows, workspace policy, git helpers, and host coordination.

## Design/Patterns
The module tree splits by concern: build orchestration, runtime orchestration/registry, OpenCode runtime process lifecycle, MCP bridge process/discovery, task workflow/document service, dev-server management, git path/provider/worktree helpers, system checks, startup metrics, workspace policy/settings, and repo-init helpers. Runtime definitions, routes, and live connections remain distinct inputs at the service boundary, and extracted `git_*`, `system_checks`, `workspace_*`, and `opencode_runtime/*` modules keep those concerns isolated.

## Data & Control Flow
`AppService` receives a command request, resolves repo/runtime state, executes the appropriate sub-service, and returns typed `host_domain` results or actionable errors. Workspace policy and settings flows load config snapshots, normalize repo settings, and persist them back through the config store.

## Integration Points
Consumes `host_domain` models and ports, `host_infra_system` config/process/git helpers, and `host_infra_beads::BeadsTaskStore` for task persistence.
