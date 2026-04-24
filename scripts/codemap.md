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
- `browser-dev.ts` starts the desktop backend (`cargo run`), waits for `/health`, then launches the frontend dev server with `VITE_ODT_BROWSER_BACKEND_URL`; it tears both down on signals or failure.
- `audit-high-severity-guard.ts` and `audit-hono-guard.ts` parse `bun audit --json` output and block release/lint flows when severity or known hono advisories are present.
- `tauri-command-panic-guard.ts` scans Rust command sources under `apps/desktop/src-tauri/src/commands` for runtime `.expect/.unwrap/panic!/todo!/unimplemented!` usage outside tests.

## Integration Points
- Root `package.json` wires these scripts into `browser:dev`, `release:version:set`, `release:version:check`, `release:homebrew:cask`, `tauri:commands:panic-guard`, `deps:audit:high`, `deps:audit:hono`, `deps:check`, and `lint`.
- The release scripts are coupled to `apps/desktop/src-tauri/tauri.conf.json` and Cargo metadata, so version changes must stay synchronized across JS and Rust manifests.
- `browser-dev.ts` depends on the desktop workspace filter (`@openducktor/desktop`) and the Rust desktop binary.
- Audit guards depend on Bun's JSON audit output and the shared severity/advisory policy encoded in this directory.
