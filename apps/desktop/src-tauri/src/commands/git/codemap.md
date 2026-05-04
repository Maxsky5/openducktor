# apps/desktop/src-tauri/src/commands/git/

## Responsibility
Git command facade for branch, diff, status, worktree, push/pull, rebase, conflict, and snapshot operations.

## Design
`command_handlers.rs` contains thin Tauri IPC wrappers. Shared authorization, request validation, service/GitPort calls, worktree cache invalidation, and snapshot hashing live under `src/command_services/git/`.

## Flow
Handlers receive Tauri arguments, build shared request structs, execute command service functions off the UI thread, and map classified command-service errors into `Result<T, String>`.

## Integration
Uses `host_infra_system::GitCliPort` indirectly through `AppService`, and returns `host_domain` git types to Tauri clients.
