# apps/desktop/src-tauri/src/command_services/git/authorization/

## Responsibility
Validate repo and worktree paths before shared git command services run.

## Design
`resolution.rs` canonicalizes filesystem paths and enforces authorized worktree scope; `cache.rs` and `metadata.rs` keep repo-specific lookups cheap and invalidatable.

## Flow
Inputs move from raw repo/worktree strings to canonical paths, then through authorization checks against repo metadata and cached worktree state tokens.

## Integration
Supports the shared git command service layer and relies on filesystem canonicalization plus repo/worktree metadata layouts, not UI or HTTP state.
