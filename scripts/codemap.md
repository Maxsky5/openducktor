# scripts/

## Responsibility
Repo-level operational scripts for release, dependency auditing, dev-server orchestration, and Tauri command safety checks. These scripts enforce cross-workspace invariants that are not owned by a single package.

## Design Patterns
- Fail-fast validation of manifest, version, and advisory inputs.
- Shared helpers for audit parsing (`audit-utils.ts`) to keep guard scripts consistent.
- CLI entrypoints with explicit flags/usage contracts.
- Direct filesystem/process orchestration; no fallback paths.

## Data & Control Flow
- `release-version.ts` reads root `package.json`, workspace `package.json` files, `apps/desktop/src-tauri/tauri.conf.json`, Cargo manifests, and `Cargo.lock`, then checks or writes a single release version across them.
- `release-homebrew-cask.ts` reads desktop release metadata from Tauri config and renders a Homebrew cask file from CLI release inputs.
- `browser-dev.ts` is a compatibility shim that routes browser-mode development through the repo-local `packages/openducktor-web/src/cli.ts --workspace` launcher.
- `audit-high-severity-guard.ts` and `audit-hono-guard.ts` parse `bun audit --json` output and block release/lint flows when severity or known hono advisories are present.
- `tauri-command-panic-guard.ts` scans Rust command sources under `apps/desktop/src-tauri/src/commands` for runtime `.expect/.unwrap/panic!/todo!/unimplemented!` usage outside tests.
- `frontend-boundary-guard.ts` enforces the shared frontend/desktop-shell split by banning direct Tauri imports in `packages/frontend/src` and keeping `apps/desktop/src` limited to shell entrypoints.

## Integration Points
- Root `package.json` wires these scripts into `browser:dev`, `release:version:set`, `release:version:check`, `release:homebrew:cask`, `tauri:commands:panic-guard`, `frontend:boundary-guard`, `deps:audit:high`, `deps:audit:hono`, `deps:check`, and `lint`.
- The release scripts are coupled to `apps/desktop/src-tauri/tauri.conf.json` and Cargo metadata, so version changes must stay synchronized across JS and Rust manifests.
- `browser-dev.ts` depends on the web workspace launcher, which owns the Rust host bootstrap and browser transport.
- Audit guards depend on Bun's JSON audit output and the shared severity/advisory policy encoded in this directory.
