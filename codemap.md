# Repository Atlas: openducktor

## Project Responsibility
OpenDucktor is a Bun monorepo for a macOS-first Tauri v2 desktop app and local browser runner that orchestrate AI planning/building workflows with Beads as the V1 task source of truth. The repository combines a shared React/Vite frontend, thin desktop and web shells, a Rust host application, shared TypeScript contracts/core services, OpenCode/Tauri adapters, an ODT MCP server, and operational scripts.

## System Entry Points
- `package.json`: root workspace manifest and Bun command surface for dev, build, test, lint, Tauri, release, and dependency guard workflows.
- `packages/frontend/src/index.ts`: shared React app, mount helper, shell bridge contract, and style export used by both shells.
- `apps/desktop/src/main.tsx`: thin Tauri desktop shell that configures the desktop shell bridge and mounts `@openducktor/frontend`.
- `packages/openducktor-web/src/cli.ts`: `@openducktor/web` launcher CLI for starting the Rust web host and Vite browser shell.
- `apps/desktop/src-tauri/src/main.rs`: Tauri desktop startup and legacy browser-backend compatibility path.
- `apps/desktop/src-tauri/src/bin/openducktor_web_host.rs`: dedicated local web host binary used by `@openducktor/web`.
- `apps/desktop/src-tauri/src/lib.rs`: Tauri command registration, app service wiring, runtime registry setup, and event relay integration.
- `packages/contracts/src/index.ts`: public shared schema/constant barrel used by packages, adapters, and host-facing boundaries.
- `packages/core/src/index.ts`: public core domain/service/port surface.
- `packages/openducktor-mcp/src/index.ts`: MCP stdio server CLI entry point for `odt_*` workflow tools.
- `scripts/*.ts`: release, dependency audit, browser dev, frontend boundary, and Tauri command guard automation invoked from the root scripts.

## Architecture Summary
- **Contracts-first boundary:** `packages/contracts` defines runtime/task/session/MCP schemas before adapters or host code translate them.
- **Hexagonal core:** `packages/core` and Rust `host-domain` define ports and policies; adapters/infra crates implement external runtime, IPC, Beads, git, config, and process integrations.
- **Shared frontend composition:** `packages/frontend/src` owns UI composition, TanStack Query read models, app-state operations, and host interaction hooks behind an explicit shell bridge.
- **Thin shell composition:** `apps/desktop/src` provides the Tauri shell bridge, while `packages/openducktor-web/src` provides the browser/local-host shell bridge and launcher.
- **Runtime/session separation:** durable task/session metadata stays separate from live runtime routes and connections; request-scoped operations resolve live runtime connections at adapter boundaries.
- **No fallback masking:** guard scripts, host startup, runtime selection, and workflow tool routing are documented to fail at the originating layer with actionable errors.

## Repository Directory Map
| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `apps/` | Application workspace boundary for the desktop product. | [apps/codemap.md](apps/codemap.md) |
| `apps/desktop/` | React/Vite desktop frontend workspace plus Tauri host integration and build scripts. | [apps/desktop/codemap.md](apps/desktop/codemap.md) |
| `apps/desktop/src/` | Thin desktop shell entrypoint and Tauri-backed shell bridge only. | [apps/desktop/src/codemap.md](apps/desktop/src/codemap.md) |
| `apps/desktop/scripts/` | Desktop-specific build, CEF, Tauri dev/build, and release helper scripts. | [apps/desktop/scripts/codemap.md](apps/desktop/scripts/codemap.md) |
| `apps/desktop/src-tauri/` | Tauri host root, command registration, browser-backend helper, and Rust workspace. | [apps/desktop/src-tauri/codemap.md](apps/desktop/src-tauri/codemap.md) |
| `apps/desktop/src-tauri/src/` | Tauri-facing Rust entrypoints, command modules, headless backend, and binary helpers. | [apps/desktop/src-tauri/src/codemap.md](apps/desktop/src-tauri/src/codemap.md) |
| `apps/desktop/src-tauri/crates/` | Rust host domain, application service, infra adapters, and test support crates. | [apps/desktop/src-tauri/crates/codemap.md](apps/desktop/src-tauri/crates/codemap.md) |
| `apps/desktop/src-tauri/capabilities/` | Tauri capability permission configuration for frontend command access. | [apps/desktop/src-tauri/capabilities/codemap.md](apps/desktop/src-tauri/capabilities/codemap.md) |
| `packages/` | Shared package workspace for the frontend app, web runner, contracts, core domain services, adapters, and MCP tooling. | [packages/codemap.md](packages/codemap.md) |
| `packages/frontend/` | Shared React/Vite frontend app consumed by desktop and web shells through a host shell bridge. | [packages/frontend/codemap.md](packages/frontend/codemap.md) |
| `packages/frontend/src/` | Frontend routes, components, feature orchestration, query/state layers, shell-bridge client seam, and runtime helpers. | [packages/frontend/src/codemap.md](packages/frontend/src/codemap.md) |
| `packages/openducktor-web/` | Public local browser runner package and Vite/web-host launcher for `bunx @openducktor/web`. | [packages/openducktor-web/codemap.md](packages/openducktor-web/codemap.md) |
| `packages/contracts/` | Shared runtime schemas, descriptors, enums, and workflow/tool constants. | [packages/contracts/codemap.md](packages/contracts/codemap.md) |
| `packages/core/` | Adapter-independent domain ports, orchestration services, guards, and workflow policies. | [packages/core/codemap.md](packages/core/codemap.md) |
| `packages/adapters-opencode-sdk/` | OpenCode SDK adapter implementing agent catalog/session/workspace inspection ports. | [packages/adapters-opencode-sdk/codemap.md](packages/adapters-opencode-sdk/codemap.md) |
| `packages/adapters-tauri-host/` | Typed Tauri IPC client adapters for workspace, task, filesystem, git, system, runtime, and build operations. | [packages/adapters-tauri-host/codemap.md](packages/adapters-tauri-host/codemap.md) |
| `packages/openducktor-mcp/` | MCP server package exposing OpenDucktor `odt_*` workflow tools over stdio. | [packages/openducktor-mcp/codemap.md](packages/openducktor-mcp/codemap.md) |
| `scripts/` | Repo-level release, dependency audit, browser dev, and Tauri command safety automation. | [scripts/codemap.md](scripts/codemap.md) |

## Deep-Dive Guidance
- Start with this atlas, then follow the directory map to the nearest scope-specific `codemap.md`.
- For shared frontend work, read `packages/frontend/src/codemap.md` plus the relevant `components/`, `pages/`, `state/`, or `features/` submap.
- For shell-specific work, read `apps/desktop/src/codemap.md` for Tauri shell code or `packages/openducktor-web/codemap.md` for browser/web-host launcher code.
- For host/runtime work, read `apps/desktop/src-tauri/codemap.md`, then the relevant `src/commands` or `crates/*` submap.
- For cross-layer contract changes, read `packages/contracts/codemap.md`, `packages/core/codemap.md`, and the corresponding adapter/host submaps before editing.
- For MCP workflow tool changes, read `packages/openducktor-mcp/codemap.md`, `packages/core/src/services/codemap.md`, and host runtime/workflow submaps.
