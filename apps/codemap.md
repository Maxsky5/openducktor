# apps/

## Responsibility
Application workspaces for OpenDucktor, currently including the legacy Tauri desktop shell and the additive Electron migration shell.

## Design Patterns
- Workspace split: `apps/desktop` owns the legacy Tauri shell, scripts, and host runtime; `apps/electron` owns the Electron shell migration; packages own shared contracts, core logic, host boundaries, adapters, and browser launcher code.
- Thin shell composition: UI and host boundaries stay explicit so contract changes flow through package surfaces first.

## Data & Control Flow
Root scripts route legacy desktop development, desktop builds, and host packaging through `apps/desktop`; Electron migration scripts route through `apps/electron`. Runtime data then flows from shared contracts/core into the shell-specific bridges and host layers.

## Integration Points
- `apps/desktop/codemap.md`
- `apps/desktop/src/codemap.md`
- `apps/desktop/scripts/codemap.md`
- `apps/electron/codemap.md`
