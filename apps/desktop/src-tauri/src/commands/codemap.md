# apps/desktop/src-tauri/src/commands/

## Responsibility
Tauri command boundary for app features like tasks, git, runtime, workspace, build, filesystem, documents, and agent sessions.

## Design
Each module exposes typed `#[tauri::command]` wrappers. Shared helpers keep handlers small and consistent, and generated schemas plus transport-neutral payload structs keep request/response shapes synchronized with the host IPC layer.

## Flow
Commands validate input, resolve authorized repo/worktree paths, and forward calls to `AppState.service`. Mutating git commands invalidate their caches after success. Agent-session, build, runtime, and workspace commands mirror the same service calls used by the headless path.

## Integration
Depends on `host-domain` IPC payloads and `host-application::AppService` APIs. Git authorization now lives in shared command services rather than a `commands/git/authorization` subtree.
