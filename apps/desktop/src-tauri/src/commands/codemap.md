# apps/desktop/src-tauri/src/commands/

## Responsibility
Tauri command boundary for app features like tasks, git, runtime, workspace, build, filesystem, documents, and agent sessions.

## Design
Each module exposes typed `#[tauri::command]` wrappers. Shared helpers like `as_error` and `run_service_blocking` keep handlers small and consistent, and generated schemas keep request/response shapes synchronized with the host IPC layer.

## Flow
Commands validate input, resolve authorized repo/worktree paths, and forward calls to `AppState.service`. Mutating git commands invalidate their caches after success.

## Integration
Depends on `host-domain` IPC payloads and `host-application::AppService` APIs. Git authorization and runtime command shapes mirror the contracts used by the browser-backend path.
