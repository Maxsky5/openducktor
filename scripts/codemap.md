# scripts/

## Responsibility

Repo-level operational scripts for release, dependency auditing, frontend boundary checks, host architecture checks, and package publishing helpers.

## Design Patterns

- Fail-fast validation of manifest, version, and advisory inputs.
- Shared helpers keep audit and release guards consistent.
- CLI entrypoints use explicit flags and no fallback paths.

## Data & Control Flow

`release-version.ts` synchronizes root and workspace package manifests. `release-homebrew-cask.ts` renders release input into a cask file from Electron metadata. Browser mode is launched through the `@openducktor/web` package dev entrypoint, while audit and architecture guards block unsafe release/lint flows.

## Integration Points

- Root `package.json`
- `apps/electron/electron-builder.yml`
- `packages/openducktor-web/src/cli.ts`
- guard/test scripts in this directory
