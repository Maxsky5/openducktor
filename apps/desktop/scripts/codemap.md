# apps/desktop/scripts/

## Responsibility
Build and environment scripts for the desktop workspace: Tauri build wrappers, CEF setup/build helpers, and git-hook test coverage.

## Design Patterns
Small Node/Bun entry points that spawn the real command or prepare build inputs. They fail loudly and pass process signals/exit codes through unchanged.

## Data & Control Flow
Scripts read the current workspace state, prepare sidecar or CEF metadata, and then hand control to `bun run tauri ...` or other child processes.

## Integration Points
`package.json` script entries, `src-tauri` build config, patched CEF/Tauri toolchain cache helpers, and `git-hooks.integration.test.ts`.
