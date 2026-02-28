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

Implementation notes:

- Workflow: `.github/workflows/dependency-hygiene.yml`

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

Implementation notes:

- Dedicated report workflow: `.github/workflows/dependency-hygiene-report.yml`

## 4) Targeted Vulnerability Gate (Hono)

- Command: `bun run deps:audit:hono`
- Backed by: `bun audit --json`
- Scope: blocks GHSA-`xh87-mx6m-69f3` reintroduction (`hono` must resolve to `>=4.12.2`)

Implementation notes:

- Included in `.github/workflows/ci.yml` Bun quality job.
- Included in `deps:check`, which runs in `.github/workflows/dependency-hygiene.yml`.

## Cadence

- Weekly (automated): Dependabot creates update PRs, and report CI publishes `bun run deps:unused:exports` plus `bun run deps:outdated` outputs.
- Per PR (automated): CI runs `bun run deps:check` to catch dependency drift and the targeted Hono regression.
- Monthly (manual): open a dependency refresh PR for safe patch/minor updates.
- Urgent security advisories: process outside cadence and patch immediately.

## Upgrade Handling Guidelines

- Prefer patch and minor upgrades in routine refreshes.
- Treat major upgrades separately with focused testing and release notes review.
- After upgrades, run:
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
