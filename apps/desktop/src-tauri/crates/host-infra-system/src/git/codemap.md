# apps/desktop/src-tauri/crates/host-infra-system/src/git/

## Responsibility
Git CLI adapter implementation.

## Design
`GitCliPort` shells out with noninteractive env settings and delegates branch, commit, merge, remote, reset, status, and worktree logic to focused helper modules.

## Flow
Each method validates repository state, runs a git command, and parses stdout/stderr into `host_domain` git records or typed errors.

## Integration
Implements the `host_domain::GitPort` trait for the application service and command layer.
