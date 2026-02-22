# Dependency Hygiene Policy

This repository uses recurring checks and automated update PRs to keep dependencies lean and up to date.

## Automated Update PRs (Dependabot)

- Config: `.github/dependabot.yml`
- Coverage:
  - Bun workspace updates from repository root
  - Cargo updates for `apps/desktop/src-tauri`
  - GitHub Actions updates
- Cadence: weekly
- Grouping: patch/minor updates are grouped to reduce PR noise

Dependabot and `knip` solve different problems:

- Dependabot proposes version upgrades and security fixes.
- `knip` detects unused dependencies/exports that update bots do not remove.

## 1) Unused Dependency Detection (Blocking)

- Command: `bun run deps:check`
- Backed by: `knip`
- Scope: all workspaces matching `@openducktor/*`
- Check type: `dependencies`

This check runs on pull requests and must pass.

## 2) Unused Export Detection (Advisory)

- Command: `bun run deps:unused`
- Backed by: `knip`
- Scope: all workspaces matching `@openducktor/*`
- Check types: `dependencies` (blocking) then `exports` (advisory report)

The export section runs with `--no-exit-code` so teams can review and clean progressively without blocking all PRs.

## 3) Outdated Dependency Review

- Command: `bun run deps:outdated`
- Backed by: `bun outdated`
- Output: package versions that can be upgraded

## Cadence

- Weekly (automated): Dependabot creates update PRs, and CI runs `bun run deps:unused` plus `bun run deps:outdated` reports.
- Per PR (automated): CI runs `bun run deps:check` to catch new dependency drift.
- Monthly (manual): open a dependency refresh PR for safe patch/minor updates.
- Urgent security advisories: process outside cadence and patch immediately.

## Upgrade Handling Guidelines

- Prefer patch and minor upgrades in routine refreshes.
- Treat major upgrades separately with focused testing and release notes review.
- After upgrades, run:
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
