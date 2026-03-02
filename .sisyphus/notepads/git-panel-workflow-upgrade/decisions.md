# Decisions

- Standardized persisted repo setting fallback to `origin/main` in Rust config defaults/normalization to align with git diff target-branch semantics.
- Kept field naming as `defaultTargetBranch` in Tauri JSON payloads and `default_target_branch` in Rust structs via existing `#[serde(rename_all = "camelCase")]` conventions.
- Implemented normalization in host infra config layer (not command layer) so both save paths and legacy config loading share one source of truth.
- Kept Task 2 scoped strictly to shared contracts: no host/adapter/frontend behavior changes yet, only schema/types + runtime schema tests + export contract updates.
