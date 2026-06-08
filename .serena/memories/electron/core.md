# Electron Core

- Location: `apps/electron` (`@openducktor/electron`); product name OpenDucktor.
- Owns desktop shell, main process, preload bridge, renderer bootstrap, packaging, sidecar staging, and Electron IPC transport into host/client layers.
- Dev entry: root `bun run electron:dev` or package `bun run dev`; renderer dev server binds `127.0.0.1:1430` with strict port.
- Build/package: root `bun run electron:build`, `bun run electron:package`, or package scripts `build`, `package`, `release:artifact`.
- Build pieces include Bun builds for main/preload, Vite renderer build, and electron-builder packaging.
- Vite/Electron dev watches Electron main/preload/shared plus `packages/contracts/src`, `packages/core/src`, and `packages/host/src`.
- Keep Electron as shell/transport. Shared UI belongs in `packages/frontend`; host logic belongs in `packages/host`; contracts belong in `packages/contracts`.