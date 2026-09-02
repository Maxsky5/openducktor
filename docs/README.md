# Documentation guide

Use this index to find the document for your task.

## Start here

- Read [the project README](../README.md) for the product summary, install steps, and contribution links.
- Read [the architecture overview](architecture-overview.md) before you change a cross-package data flow or ownership boundary.
- Read [the Effect guide](effect.md) before you change a host port, service, adapter, lifecycle, or typed error.
- Read [the runtime integration guide](runtime-integration-guide.md) before you add a runtime or change runtime capabilities, sessions, history, approvals, prompts, or catalogs.
- Read [the CLI and tool discovery guide](cli-tool-discovery.md) before you add a CLI tool or change how a shell finds one.
- Read [the TanStack Query cache strategy](tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

## Task workflow

- [Task status model](task-workflow-status-model.md) defines task statuses, issue types, and document ownership.
- [Task actions](task-workflow-actions.md) defines action IDs and their effects.
- [Task transition matrix](task-workflow-transition-matrix.md) defines allowed transitions and guards.
- [Task description Markdown](task-description-markdown.md) defines task Markdown, image assets, and agent access.

## Runtimes and tools

- [Agent orchestrator module map](agent-orchestrator-module-map.md) maps frontend agent orchestration code and ownership.
- [External MCP](external-mcp.md) defines package use, host bridge startup, workspace scope, and public task tools.
- [Interactive terminal architecture](interactive-terminal-architecture.md) defines terminal ownership, transport, replay, and cleanup.
- [Web runner](web-runner.md) defines the local browser runner and its release package.
- [Architecture decision records](adr/) record accepted and superseded technical decisions.

## Security and maintenance

- [MCP runtime security](mcp-runtime-security.md) defines the allowed MCP transport and threat assumptions.
- [Dependency hygiene](dependency-hygiene.md) defines dependency checks and update rules.
- [Release process](release-process.md) defines desktop, web, MCP, and Homebrew releases.
