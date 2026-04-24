# apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/registry/

## Responsibility
Runtime registry lifecycle helpers for attaching, stopping, querying, and cleaning up registered runtimes.

## Design
`lifecycle.rs` manages runtime attachment/stop/shutdown behavior, `query.rs` lists and filters active runtimes, and `cleanup.rs` handles process/worktree teardown.

## Flow
After startup the service attaches a runtime into the registry, later queries or stops it by id, and finally drains the registry during shutdown.

## Integration
Operates on `AgentRuntimeProcess` records inside `AppService` and uses `host_infra_system` process cleanup helpers.
