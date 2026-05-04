# apps/desktop/

## Responsibility
Tauri desktop workspace for OpenDucktor. It owns the thin shell, desktop bridge, Tauri config, packaging helpers, and the Rust host workspace under `src-tauri/`.

## Design Patterns
- Thin-shell boundary: `src/main.tsx` only supplies the desktop shell bridge to the shared frontend bootstrap.
- Workspace-local packaging: scripts prepare desktop build inputs, CEF assets, and Tauri release artifacts without mixing UI logic into the host.
- Host/runtime concerns stay in `src-tauri/`; UI code does not reach into Rust internals directly.

## Data & Control Flow
`src/main.tsx` loads shared styles and calls `bootstrapOpenDucktorShell` with the desktop shell bridge factory. Build/release scripts shape CEF/Tauri inputs before the host is launched or packaged, while `src-tauri/` owns command registration, headless routing, and host service wiring.

## Integration Points
`package.json`, `vite.config.ts`, `src/desktop-shell-bridge.ts`, `src-tauri`, and `scripts/*.ts`.
