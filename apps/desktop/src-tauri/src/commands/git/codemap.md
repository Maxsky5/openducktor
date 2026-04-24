# apps/desktop/src-tauri/src/commands/git/

## Responsibility
Git command facade for branch, diff, status, worktree, push/pull, rebase, conflict, and snapshot operations.

## Design
Authorization lives under `authorization/`, request validation and mutation handlers live in `command_handlers.rs`, and snapshot hashing is centralized in `snapshot.rs`.

## Flow
Handlers resolve an authorized repo/worktree scope, call either `AppService` or the underlying git port, then invalidate worktree-resolution caches after mutations.

## Integration
Uses `host_infra_system::GitCliPort` indirectly through `AppService`, and returns `host_domain` git types to Tauri clients.
