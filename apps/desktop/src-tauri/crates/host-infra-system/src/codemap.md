# apps/desktop/src-tauri/crates/host-infra-system/src/

## Responsibility
Implementation modules behind the infra crate root.

## Design
Modules stay focused by concern (`config`, `git`, `beads`, `process`, `filesystem`, `open_in`, `user_paths`, `worktree`) and are reexported from `lib.rs`.

## Flow
Higher layers use the reexports instead of importing nested modules directly, which keeps the host boundary stable while internals evolve.

## Integration
Supports the application service and Beads adapter with filesystem, process, config, and git primitives.
