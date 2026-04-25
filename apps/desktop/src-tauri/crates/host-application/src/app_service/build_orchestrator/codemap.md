# apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/

## Responsibility
Task build startup and session teardown coordination.

## Design
This area splits build lifecycle logic from worktree preparation, runtime setup, and session stop handling so start/stop concerns stay isolated.

## Flow
Build start validates prerequisites, prepares a worktree, ensures the runtime is available through the registry/orchestrator, transitions the task into progress, and returns a `BuildSessionBootstrap` for the caller.

## Integration
Depends on runtime orchestration, task workflow transitions, and `host_domain::BuildSessionBootstrap` / `RuntimeRoute`.
