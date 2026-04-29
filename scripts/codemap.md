# scripts/

## Responsibility
Repo-level operational scripts for release, dependency auditing, dev-server orchestration, and Tauri command safety checks.

## Design Patterns
- Fail-fast validation of manifest, version, and advisory inputs.
- Shared helpers keep audit and release guards consistent.
- CLI entrypoints use explicit flags and no fallback paths.

## Data & Control Flow
`release-version.ts` synchronizes root/workspace manifests and Cargo metadata. `release-homebrew-cask.ts` renders release input into a cask file. `browser-dev.ts` routes browser mode through the web launcher, while audit and panic guards block unsafe release/lint flows.

## Integration Points
- Root `package.json`
- `apps/desktop/src-tauri/tauri.conf.json` and Cargo metadata
- `packages/openducktor-web/src/cli.ts`
- guard/test scripts in this directory
