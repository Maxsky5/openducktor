# apps/desktop/src-tauri/crates/host-infra-system/

## Responsibility
Shared host infrastructure for config, Beads paths/server state, git CLI access, filesystem helpers, process resolution, open-in tools, user paths, and worktree utilities.

## Design/Patterns
This crate is the common infra toolbox: config stores normalize and persist JSON, git wraps the CLI, Beads helpers resolve durable paths, and process helpers locate executables without UI coupling. Config work stays split between app/runtime stores, normalization, migration, security, and workspace icon discovery.

## Data & Control Flow
Application services ask these helpers for canonical repo paths, workspace config, git operations, worktree management, or shared-Dolt state; the helpers validate, normalize, canonicalize, and shell out as needed.

## Integration Points
Feeds `host-application` and `host-infra-beads`, while exporting the config/runtime stores and utility ports used by the Tauri host.
