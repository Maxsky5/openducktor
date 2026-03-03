# Decisions

- Standardized persisted repo setting fallback to `origin/main` in Rust config defaults/normalization to align with git diff target-branch semantics.
- Kept field naming as `defaultTargetBranch` in Tauri JSON payloads and `default_target_branch` in Rust structs via existing `#[serde(rename_all = "camelCase")]` conventions.
- Implemented normalization in host infra config layer (not command layer) so both save paths and legacy config loading share one source of truth.
- Kept Task 2 scoped strictly to shared contracts: no host/adapter/frontend behavior changes yet, only schema/types + runtime schema tests + export contract updates.
- Mirrored Task 2 contract semantics in host-domain with DTO names and discriminated outcomes (`committed|no_changes`, `rebased|up_to_date|conflicts`) to keep cross-layer intent stable.
- Kept domain contracts transport-agnostic by modeling outcomes as enums/DTOs only, with no git CLI output parsing rules in `host-domain`.

- Kept adapter git method signatures positional with optional trailing `workingDir` to match existing git client style and avoid changing caller shape.
- Used contract request/response schema parsing for command outputs in `git-client` to keep adapter surface typed and transport-safe.
- Kept commit/rebase command input shape flat in Tauri (`repoPath`, optional `workingDir`, plus operation field) to match existing invoke conventions and avoid introducing nested payload DTOs in command signatures.
- Forwarded resolved working directory into app-service request DTOs for commit/rebase so downstream git port executes against the validated effective path.
- Kept `ensure_repo_authorized` unchanged and hardened only `resolve_working_dir` by enforcing canonical membership in the authorized repo root/worktree set derived from git porcelain output.
- Kept Task 10 scoped to hook/state/page wiring only (no git panel UI redesign), with new action state exposed through the existing diff model shape merge in `agents-page.tsx`.
- Used per-action loading/error slices instead of a shared busy/error state so rebase failure can be surfaced without marking push/commit as failed or loading.
- On successful mutating actions, clear all action errors before refresh to remove stale cross-action failure messages while preserving operation-specific errors on failure.

- Used `fileStatuses.length > 0` as the commit-all eligibility signal for Task 11 so commit submit availability tracks uncommitted/staged changes without introducing new backend/UI contracts.
- Kept `hasDiffPanel: viewRole === "build"` and role-to-panel mapping unchanged; only model plumbing was refactored so build remains diff-owner and non-build roles remain document-only.
- Chose helper-based model assembly in `use-agent-studio-right-panel.ts` and consumed it from `agents-page.tsx` to avoid broad orchestration-controller API changes while still enforcing enhanced diff model wiring.

#TR|- For Task 13 finalization, acceptance is based on targeted regression tests + package validation, while treating full-suite noise/timeouts and non-actionable legacy harness failures as pre-existing environment debt.
