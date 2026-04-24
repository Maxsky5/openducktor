# Repository Atlas: openducktor

## Project Responsibility
OpenDucktor is a Bun monorepo for a macOS-first Tauri v2 desktop app that orchestrates AI planning/building workflows with Beads as the V1 task source of truth. The repository combines a React/Vite desktop UI, a Rust host application, shared TypeScript contracts/core services, OpenCode/Tauri adapters, an ODT MCP server, and operational scripts.

## System Entry Points
- `package.json`: root workspace manifest and Bun command surface for dev, build, test, lint, Tauri, release, and dependency guard workflows.
- `apps/desktop/src/main.tsx`: frontend bootstrap that preloads settings/theme and mounts the React app.
- `apps/desktop/src/App.tsx`: frontend provider and route composition entry point.
- `apps/desktop/src-tauri/src/main.rs`: Tauri desktop/browser-backend mode selection and Rust host startup.
- `apps/desktop/src-tauri/src/lib.rs`: Tauri command registration, app service wiring, runtime registry setup, and event relay integration.
- `packages/contracts/src/index.ts`: public shared schema/constant barrel used by packages, adapters, and host-facing boundaries.
- `packages/core/src/index.ts`: public core domain/service/port surface.
- `packages/openducktor-mcp/src/index.ts`: MCP stdio server CLI entry point for `odt_*` workflow tools.
- `scripts/*.ts`: release, dependency audit, browser dev, and Tauri command guard automation invoked from the root scripts.

## Architecture Summary
- **Contracts-first boundary:** `packages/contracts` defines runtime/task/session/MCP schemas before adapters or host code translate them.
- **Hexagonal core:** `packages/core` and Rust `host-domain` define ports and policies; adapters/infra crates implement external runtime, IPC, Beads, git, config, and process integrations.
- **Desktop composition:** `apps/desktop/src` owns UI composition, TanStack Query read models, app-state operations, and host interaction hooks; `apps/desktop/src-tauri` owns fail-fast Rust host orchestration.
- **Runtime/session separation:** durable task/session metadata stays separate from live runtime routes and connections; request-scoped operations resolve live runtime connections at adapter boundaries.
- **No fallback masking:** guard scripts, host startup, runtime selection, and workflow tool routing are documented to fail at the originating layer with actionable errors.

## Repository Directory Map
| Directory | Responsibility Summary | Detailed Map |
|-----------|------------------------|--------------|
| `apps/` | Application workspace boundary for the desktop product. | [apps/codemap.md](apps/codemap.md) |
| `apps/desktop/` | React/Vite desktop frontend workspace plus Tauri host integration and build scripts. | [apps/desktop/codemap.md](apps/desktop/codemap.md) |
| `apps/desktop/src/` | Frontend routes, components, feature orchestration, query/state layers, and runtime helpers. | [apps/desktop/src/codemap.md](apps/desktop/src/codemap.md) |
| `apps/desktop/src/components/` | Shared layout, UI primitives, feature components, and error surfaces. | [apps/desktop/src/components/codemap.md](apps/desktop/src/components/codemap.md) |
| `apps/desktop/src/pages/` | Route-level page composition for Agent Studio and Kanban workflows. | [apps/desktop/src/pages/codemap.md](apps/desktop/src/pages/codemap.md) |
| `apps/desktop/src/state/` | App providers, TanStack Query option builders, read models, lifecycle state, task state, and host-backed operations. | [apps/desktop/src/state/codemap.md](apps/desktop/src/state/codemap.md) |
| `apps/desktop/src/features/` | Cross-page workflow modules such as autopilot, session start, build tools, git, and review feedback. | [apps/desktop/src/features/codemap.md](apps/desktop/src/features/codemap.md) |
| `apps/desktop/src/lib/` | Shared frontend utilities for browser-live integration, diffs, host/runtime helpers, and pure support code. | [apps/desktop/src/lib/codemap.md](apps/desktop/src/lib/codemap.md) |
| `apps/desktop/src/types/` | Frontend-shared type aliases and feature-facing structural types. | [apps/desktop/src/types/codemap.md](apps/desktop/src/types/codemap.md) |
| `apps/desktop/scripts/` | Desktop-specific build, CEF, Tauri dev/build, and release helper scripts. | [apps/desktop/scripts/codemap.md](apps/desktop/scripts/codemap.md) |
| `apps/desktop/src-tauri/` | Tauri host root, command registration, browser-backend helper, and Rust workspace. | [apps/desktop/src-tauri/codemap.md](apps/desktop/src-tauri/codemap.md) |
| `apps/desktop/src-tauri/src/` | Tauri-facing Rust entrypoints, command modules, headless backend, and binary helpers. | [apps/desktop/src-tauri/src/codemap.md](apps/desktop/src-tauri/src/codemap.md) |
| `apps/desktop/src-tauri/crates/` | Rust host domain, application service, infra adapters, and test support crates. | [apps/desktop/src-tauri/crates/codemap.md](apps/desktop/src-tauri/crates/codemap.md) |
| `apps/desktop/src-tauri/capabilities/` | Tauri capability permission configuration for frontend command access. | [apps/desktop/src-tauri/capabilities/codemap.md](apps/desktop/src-tauri/capabilities/codemap.md) |
| `packages/` | Shared package workspace for contracts, core domain services, adapters, and MCP tooling. | [packages/codemap.md](packages/codemap.md) |
| `packages/contracts/` | Shared runtime schemas, descriptors, enums, and workflow/tool constants. | [packages/contracts/codemap.md](packages/contracts/codemap.md) |
| `packages/core/` | Adapter-independent domain ports, orchestration services, guards, and workflow policies. | [packages/core/codemap.md](packages/core/codemap.md) |
| `packages/adapters-opencode-sdk/` | OpenCode SDK adapter implementing agent catalog/session/workspace inspection ports. | [packages/adapters-opencode-sdk/codemap.md](packages/adapters-opencode-sdk/codemap.md) |
| `packages/adapters-tauri-host/` | Typed Tauri IPC client adapters for workspace, task, filesystem, git, system, runtime, and build operations. | [packages/adapters-tauri-host/codemap.md](packages/adapters-tauri-host/codemap.md) |
| `packages/openducktor-mcp/` | MCP server package exposing OpenDucktor `odt_*` workflow tools over stdio. | [packages/openducktor-mcp/codemap.md](packages/openducktor-mcp/codemap.md) |
| `scripts/` | Repo-level release, dependency audit, browser dev, and Tauri command safety automation. | [scripts/codemap.md](scripts/codemap.md) |

## Deep-Dive Guidance
- Start with this atlas, then follow the directory map to the nearest scope-specific `codemap.md`.
- For frontend work, read `apps/desktop/src/codemap.md` plus the relevant `components/`, `pages/`, `state/`, or `features/` submap.
- For host/runtime work, read `apps/desktop/src-tauri/codemap.md`, then the relevant `src/commands` or `crates/*` submap.
- For cross-layer contract changes, read `packages/contracts/codemap.md`, `packages/core/codemap.md`, and the corresponding adapter/host submaps before editing.
- For MCP workflow tool changes, read `packages/openducktor-mcp/codemap.md`, `packages/core/src/services/codemap.md`, and host runtime/workflow submaps.
