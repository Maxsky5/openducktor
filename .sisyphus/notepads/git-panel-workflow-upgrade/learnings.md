# Learnings

- `defaultTargetBranch` exists in TS contracts/state/UI and is sent through adapter `workspace_save_repo_settings`, but rust tauri payload/config currently drops it.
- `RepoSettingsPayload` in `apps/desktop/src-tauri/src/lib.rs` currently lacks default target branch field.
- Rust `RepoConfig` persistence model in `apps/desktop/src-tauri/crates/host-infra-system/src/config/types.rs` currently lacks target branch storage.
- Frontend fallback values are inconsistent today (`main` in settings flow vs `origin/main` in diff flow).
- Plan task 1 requires normalizing blank target branch values to `origin/main`.
- Added `default_target_branch` to both Tauri payload structs and mapped it through `workspace_update_repo_config` and `workspace_save_repo_settings` into persisted `RepoConfig`.
- `RepoConfig` now uses serde default `default_target_branch()` to preserve backward compatibility for existing config files that do not yet contain the field.
- Normalization now trims `default_target_branch` and coerces blank/whitespace values to `origin/main` at the Rust config normalization layer.
- Host infra config tests now explicitly cover persistence of a non-empty target branch and normalization of blank target branch values.
- Added `GitCommitAll` and `GitRebaseBranch` request/result schemas in contracts with explicit discriminated outcome unions and tests for happy-path + edge outcomes.
