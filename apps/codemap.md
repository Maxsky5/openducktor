# apps/

## Responsibility
Application workspaces for OpenDucktor. Today this contains the desktop product workspace, which combines the React/Vite frontend and the Tauri v2 host boundary.

## Design Patterns
- Monorepo application boundary: `apps/desktop` owns product composition while `packages/*` provide contracts, core services, and adapters.
- Host/UI co-location: frontend source and Rust Tauri host live in one workspace so IPC contracts and desktop packaging evolve together.
- Generated subdirectory codemaps delegate detailed architecture to the relevant frontend, script, and Rust host folders.

## Data & Control Flow
Root Bun scripts target `@openducktor/desktop` for development, build, and Tauri commands. The desktop app boots React routes in `apps/desktop/src`, invokes host APIs through adapter packages, and crosses into `apps/desktop/src-tauri` for Rust command execution, Beads task storage, runtime orchestration, and desktop/browser-backend serving.

## Integration Points
- `apps/desktop/codemap.md`: desktop workspace overview.
- `apps/desktop/src/codemap.md`: React frontend source map.
- `apps/desktop/src-tauri/codemap.md`: Rust/Tauri host map.
- `apps/desktop/scripts/codemap.md`: desktop build, CEF, and Tauri helper scripts.
