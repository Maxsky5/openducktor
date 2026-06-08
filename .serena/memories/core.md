# OpenDucktor Core

- Bun monorepo for a macOS-first Electron desktop app plus local browser/web runner that orchestrate AI planning/building workflows with Beads as task source of truth.
- Workspace roots: `apps/*`, `packages/*`. Current packages include Electron app, shared frontend, contracts, core, host, host-client, runtime adapters, MCP server, web runner, build tools, and path-support.
- Main source map:
  - `apps/electron`: Electron shell, renderer bootstrap, preload bridge, packaging, IPC transport.
  - `packages/frontend`: shared React/Vite UI used by Electron and web runner.
  - `packages/contracts`: public Zod schemas and IPC/runtime/task contracts.
  - `packages/core`: pure/shared domain types, policies, and ports.
  - `packages/host`: Effect-native host services, command routing, use cases, infrastructure adapters.
  - `packages/host-client`: frontend host/IPC adapter layer.
  - `packages/adapters-opencode-sdk`, `packages/adapters-codex-app-server`: agent runtime adapters.
  - `packages/openducktor-mcp`: MCP server exposing ODT workflow tools.
  - `packages/openducktor-web`: local browser runner / web package.
- Durable docs: `docs/architecture-overview.md`, `docs/effect.md`, `docs/runtime-integration-guide.md`, `docs/task-workflow-*.md`, `docs/tanstack-query-cache-strategy.md`, `docs/external-mcp.md`, `docs/adr/`.
- Read `mem:tech_stack` for versions/tools, `mem:conventions` for project-wide rules, `mem:suggested_commands` for commands, and `mem:task_completion` before finishing code work.
- Read `mem:frontend/core` for React/TanStack/styling rules, `mem:host/core` for Effect/port rules, `mem:contracts/core` for schema contract ownership, `mem:workflow/core` for Beads task lifecycle and ODT tool workflow, `mem:mcp/core` for MCP-specific contracts, `mem:electron/core` for desktop shell, and `mem:web-runner/core` for browser runner.