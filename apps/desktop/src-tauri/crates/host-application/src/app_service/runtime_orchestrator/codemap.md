# apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/

## Responsibility
Workspace/runtime lifecycle orchestration for startup, health checks, registry access, and running-instance management.

## Design
Submodules separate startup pipelines, repo-health snapshots, registry plumbing, runtime state reconciliation, and workspace-specific runtime management.

## Flow
The service validates runtime descriptors, resolves support for workflow scopes, starts or reuses runtimes, and publishes startup/health summaries for the current repo.

## Integration
Uses `host_domain` runtime contracts, the runtime registry, and infra helpers for opencode process management and session-status probing.
