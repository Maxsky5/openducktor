# apps/electron/

## Responsibility
Electron desktop shell for OpenDucktor. It mounts the shared frontend, exposes a secure preload bridge, and adapts Electron IPC to the TypeScript host boundary in `@openducktor/host`.

## Design Patterns
- Thin shell composition: renderer code delegates shared UI to `@openducktor/frontend`.
- Hexagonal host integration: the Electron main process calls the transport-neutral host command router instead of implementing domain behavior in IPC handlers.
- Secure preload boundary: renderer code receives a narrow `window.openducktorElectron` API through `contextBridge`; direct Electron and Node APIs are not exposed to the React tree.

## Data & Control Flow
`src/main/main.ts` creates the `BrowserWindow`, registers IPC handlers, forwards host events from a shared event bus, and loads either a Vite dev URL or the built renderer. `src/main/electron-host.ts` is a shell-local alias for `createNodeHostCommandRouter(...)` from `@openducktor/host`, which composes migrated TypeScript host services including filesystem browsing, git state, GitHub repository detection, local attachments, external "Open In" tools, runtime definitions/registry/startup, MCP host-bridge resolution, diagnostics, Beads task workflows, spec/plan persistence, build-start/build-completion workflows, QA/human review workflows, task-owned worktree discovery, dev-server state/process control, and workspace lifecycle/settings commands. OpenCode and Codex MCP sidecar command resolution is handled by the TypeScript host adapter through explicit command JSON, explicit packaged sidecar path, or the repo workspace MCP entrypoint. `src/preload/preload.ts` validates command/event channels and exposes invoke/subscribe helpers. `src/renderer/electron-shell-bridge.ts` adapts that preload API to the shared `ShellBridge` contract consumed by `@openducktor/frontend`.

## Integration Points
- `@openducktor/frontend`
- `@openducktor/adapters-tauri-host`
- `@openducktor/host`
