# apps/desktop/src-tauri/crates/host-command-services/src/command_services/git/

## Responsibility
Shared git command behavior for branch, diff, status, worktree, push/pull, rebase, conflict, authorization, and snapshot operations.

## Design
`requests.rs` owns transport-neutral command inputs, `authorization/` handles canonical path validation/cache/listing/metadata, `snapshot.rs` centralizes snapshot hashing, and `mod.rs` exposes one shared function per command plus shared repo/worktree authorization helpers.

## Flow
Git command services authorize the repo/effective working directory, validate required fields and diff scope, call `AppService` or `GitPort`, invalidate worktree caches after successful worktree mutations, and return classified errors.

## Integration
Used by desktop `commands/git/command_handlers.rs` for Tauri and web-host/headless `git_commands.rs` for browser-backend HTTP while preserving existing public command names and payload shapes.
