# apps/desktop/scripts/

## Responsibility
Desktop-workspace scripts for Tauri builds, CEF preparation, release packaging, and guard checks.

## Design Patterns
- Small Bun entrypoints prepare inputs and then hand off to the real build or packaging command.
- Fail-fast process plumbing preserves the underlying exit code and error source.

## Data & Control Flow
Scripts derive workspace/build metadata, prepare CEF or sidecar assets, and then invoke Tauri or release tooling. Guard scripts verify the desktop packaging surface before publish steps proceed.

## Integration Points
`package.json`, `src-tauri` build config, CEF/toolchain helpers, and script-level tests.
