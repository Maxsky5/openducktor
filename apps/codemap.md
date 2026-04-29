# apps/

## Responsibility
Application workspaces for OpenDucktor, centered on the desktop product shell and its build/runtime helpers.

## Design Patterns
- Workspace split: `apps/desktop` owns the Tauri shell, scripts, and host runtime while packages own shared contracts, core logic, adapters, and browser launcher code.
- Thin shell composition: UI and host boundaries stay explicit so contract changes flow through package surfaces first.

## Data & Control Flow
Root scripts route desktop development, desktop builds, and host packaging through `apps/desktop`; runtime data then flows from shared contracts/core into the desktop shell and Rust host layers.

## Integration Points
- `apps/desktop/codemap.md`
- `apps/desktop/src/codemap.md`
- `apps/desktop/scripts/codemap.md`
