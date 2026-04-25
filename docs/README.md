# Documentation Guide

This folder contains the project documentation that explains how OpenDucktor is built today and how it is expected to evolve.

## Read This First

- [../README.md](../README.md): public project overview, install guide, and contribution entry point.
- [architecture-overview.md](architecture-overview.md): high-level map of the system and how data moves across layers.
- [runtime-integration-guide.md](runtime-integration-guide.md): how runtimes fit into OpenDucktor and what a new runtime integration requires.
- [web-runner.md](web-runner.md): local browser runner architecture, command usage, and package/release expectations.

## Workflow Docs

- [task-workflow-status-model.md](task-workflow-status-model.md): canonical task statuses, metadata ownership, and issue-type rules.
- [task-workflow-actions.md](task-workflow-actions.md): canonical workflow actions and UI rendering expectations.
- [task-workflow-transition-matrix.md](task-workflow-transition-matrix.md): allowed transitions, guards, and invalid examples.

## Runtime And Architecture Docs

- [agent-orchestrator-module-map.md](agent-orchestrator-module-map.md): maintainer map for the desktop agent orchestration modules.
- [agent-runtime-implementation-plan.md](agent-runtime-implementation-plan.md): runtime abstraction plan and guardrails.
- [agent-ui-library-evaluation.md](agent-ui-library-evaluation.md): reasoning behind the current agent UI approach.
- [beads-shared-dolt-lifecycle.md](beads-shared-dolt-lifecycle.md): detailed Beads attachment and shared Dolt lifecycle, command inventory, startup, hydration, and shutdown rules.
- [external-mcp.md](external-mcp.md): public MCP package usage, host-bridge startup contract, and the external task tools.
- [runtime-integration-guide.md](runtime-integration-guide.md): runtime vocabulary, capability model, integration checklist, and verification path.
- [web-runner.md](web-runner.md): how `@openducktor/web` starts the Rust host and serves the shared frontend without Tauri.

## Security And Maintenance Docs

- [mcp-runtime-security.md](mcp-runtime-security.md): current MCP transport and threat assumptions.
- [desktop-csp-hardening.md](desktop-csp-hardening.md): current desktop CSP baseline and hardening plan.
- [dependency-hygiene.md](dependency-hygiene.md): dependency update and audit policy.
- [release-process.md](release-process.md): desktop release workflow, required secrets, version sync, and draft publishing steps.
