# Documentation Guide

This folder contains the project documentation for OpenDucktor's current architecture, runtime model, release process, and task workflow.

## Read This First

- [../README.md](../README.md): public project overview, install guide, and contribution entry point.
- [architecture-overview.md](architecture-overview.md): high-level map of the shared frontend, Electron/browser shells, TypeScript host, Beads persistence, and runtime data flows.
- [cli-tool-discovery.md](cli-tool-discovery.md): host-owned CLI discovery architecture, descriptor source order, distribution-mode boundaries, and the checklist for adding new tools.
- [effect.md](effect.md): current Effect conventions for host ports, services, adapters, lifecycle, testing, and public boundaries.
- [tanstack-query-cache-strategy.md](tanstack-query-cache-strategy.md): frontend cache strategy and the boundary between Query-owned reads and host/runtime execution.
- [runtime-integration-guide.md](runtime-integration-guide.md): how OpenCode and Codex fit into OpenDucktor and what another runtime integration requires.
- [web-runner.md](web-runner.md): local browser runner architecture, command usage, and package/release expectations for the TypeScript host backend.
- [adr/](adr/): architecture decision records explaining durable technical choices and rejected alternatives.

## Workflow Docs

- [task-workflow-status-model.md](task-workflow-status-model.md): canonical task statuses, metadata ownership, and issue-type rules.
- [task-workflow-actions.md](task-workflow-actions.md): canonical workflow actions and UI rendering expectations.
- [task-workflow-transition-matrix.md](task-workflow-transition-matrix.md): allowed transitions, guards, and invalid examples.

## Runtime And Architecture Docs

- [agent-orchestrator-module-map.md](agent-orchestrator-module-map.md): maintainer map for the shared frontend agent orchestration modules.
- [beads-shared-dolt-lifecycle.md](beads-shared-dolt-lifecycle.md): detailed Beads attachment and shared Dolt lifecycle, command inventory, startup, hydration, and shutdown rules.
- [cli-tool-discovery.md](cli-tool-discovery.md): TypeScript host CLI/tool discovery map for Electron, web, and source/package distributions.
- [external-mcp.md](external-mcp.md): public MCP package usage, host-bridge startup contract, and the external task tools.
- [runtime-integration-guide.md](runtime-integration-guide.md): runtime vocabulary, capability model, integration checklist, and verification path.
- [tanstack-query-cache-strategy.md](tanstack-query-cache-strategy.md): frontend read-cache ownership, invalidation rules, and how Effect-backed host calls should coexist with TanStack Query.
- [web-runner.md](web-runner.md): how `@openducktor/web` starts the local TypeScript host and serves the shared frontend in browser mode.

## Security And Maintenance Docs

- [mcp-runtime-security.md](mcp-runtime-security.md): current MCP transport and threat assumptions.
- [dependency-hygiene.md](dependency-hygiene.md): dependency update and audit policy.
- [release-process.md](release-process.md): Electron desktop, MCP, web package, Homebrew, version sync, and draft publishing steps.
