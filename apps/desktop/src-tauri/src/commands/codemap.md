# apps/desktop/src-tauri/src/commands/

## Responsibility
Tauri command boundary for app features like tasks, git, runtime, workspace settings, build, filesystem, documents, agent sessions, and local attachments.

## Design/Patterns
Each module exposes typed `#[tauri::command]` wrappers. Shared helpers keep handlers small and consistent, and generated schemas plus transport-neutral payload structs keep request/response shapes synchronized with the host IPC layer. Workspace commands now cover repo config merges, settings snapshots, and attachment staging/resolution.

## Data & Control Flow
Commands validate input, resolve authorized repo/worktree paths, and forward calls to `AppState.service`. Mutating git commands invalidate their caches after success. Agent-session, build, runtime, and workspace commands mirror the same service calls used by the headless path.

## Integration Points
Depends on `host-domain` IPC payloads and `host-application::AppService` APIs. Git authorization now lives in shared command services rather than a `commands/git/authorization` subtree.
