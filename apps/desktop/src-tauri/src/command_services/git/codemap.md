# apps/desktop/src-tauri/src/command_services/git/

## Responsibility
Shared git command behavior for branch, diff, status, worktree, push/pull, rebase, conflict, authorization, and snapshot operations.

## Design
`requests.rs` owns transport-neutral command inputs, `authorization/` validates repo/worktree scope, `snapshot.rs` centralizes snapshot hashing, and `mod.rs` exposes one shared function per command.

## Flow
Git command services authorize the repo/effective working directory, validate required fields and diff scope, call `AppService` or `GitPort`, invalidate worktree caches after successful worktree mutations, and return classified errors.

## Integration
Used by `commands/git/command_handlers.rs` for Tauri and `headless/git_commands.rs` for browser-backend HTTP while preserving existing public command names and payload shapes.
