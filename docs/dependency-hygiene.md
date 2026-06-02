# Dependency Hygiene Policy

This repository uses recurring checks and automated update PRs to keep dependencies lean and up to date.

## Automated Update PRs (Dependabot)

- Config: `.github/dependabot.yml`
- Coverage:
  - Bun workspace updates from repository root
  - GitHub Actions updates
- Cadence: weekly
- Grouping: patch/minor updates are grouped to reduce PR noise

Dependabot and `knip` solve different problems:

- Dependabot proposes version upgrades and security fixes.
- `knip` detects unused dependencies/exports that update bots do not remove.

## 1) Blocking Dependency Hygiene Gate

- Command: `bun run deps:check`
- Includes:
  - `bun run deps:audit:high`
  - `bun run deps:audit:hono`
  - `bun run deps:unused:deps`
  - `bun run deps:unused:exports`

This check runs on pull requests and `main` pushes and must pass.

Implementation notes:

- Workflow: `.github/workflows/dependency-hygiene.yml`

## 2) Unused Dependency Detection (Blocking Component)

- Command: `bun run deps:unused:deps`
- Backed by: `knip`
- Scope: all workspaces matching `@openducktor/*`
- Check type: `dependencies`
- Implementation: `bunx knip --workspace='@openducktor/*' --include dependencies`

This check is included in `deps:check`.

## 3) Unused Export Detection (Blocking Component)

- Command: `bun run deps:unused:exports`
- Backed by: `knip`
- Scope: all workspaces matching `@openducktor/*`
- Check type: `exports`
- Implementation: `bunx knip --workspace='@openducktor/*' --include exports`

This check is included in `deps:check`.

Implementation notes:

- Report-only command: `bun run deps:unused:exports:report`
- Report-only implementation: `bunx knip --workspace='@openducktor/*' --include exports --no-exit-code`
- Use the report-only command only for artifact generation where the workflow needs to publish findings even when unused exports exist. Do not use it for blocking local or CI gates.
- Intentional public entry points or generated files should be excluded in Knip configuration with a short rationale next to the exclusion.
- Do not export production symbols only for tests. Cover private helpers through public behavior, or move reusable test setup into test files.
- When Knip reports an export that is only used inside its own source file, remove the `export` keyword unless another module should import it.

## 4) Outdated Dependency Review

- Command: `bun run deps:outdated`
- Backed by: `bun outdated`
- Output: package versions that can be upgraded

Implementation notes:

- Dedicated report workflow: `.github/workflows/dependency-hygiene-report.yml`

## 5) High/Critical Vulnerability Gate

- Command: `bun run deps:audit:high`
- Backed by: `bun audit --json`
- Scope: blocks any dependency that resolves to a high or critical advisory

Implementation notes:

- Included in `deps:check`, which runs in `.github/workflows/dependency-hygiene.yml`.

## 6) Targeted Vulnerability Gate (Hono)

- Command: `bun run deps:audit:hono`
- Backed by: `bun audit --json`
- Scope: blocks GHSA-`xh87-mx6m-69f3` and GHSA-`v8w9-8mx6-g223` reintroduction (`hono` must resolve to `>=4.12.7`)

Implementation notes:

- Included in `deps:check`, which runs in `.github/workflows/dependency-hygiene.yml`.

## Cadence

- Weekly (automated): Dependabot creates update PRs, and report CI publishes `bun run deps:unused:exports:report` plus `bun run deps:outdated` outputs.
- Per PR and on `main` pushes (automated): dependency hygiene CI runs `bun run deps:check` to catch dependency drift, unused exports, and vulnerability regressions without blocking lint/typecheck/test/build.
- Monthly (manual): open a dependency refresh PR for safe patch/minor updates.
- Urgent security advisories: process outside cadence and patch immediately.

## Upgrade Handling Guidelines

- Prefer patch and minor upgrades in routine refreshes.
- Treat major upgrades separately with focused testing and release notes review.
- After upgrades, run:
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
