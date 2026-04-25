# apps/desktop/src-tauri/crates/host-application/

## Responsibility
Application service crate that orchestrates OpenDucktor host behavior.

## Design
`AppService` is the main coordinator. Supporting modules cover runtime orchestration, task workflows, build orchestration, MCP bridge process/registry management, workspace policy, process tracking, and startup metrics.

## Flow
Commands and headless handlers call `AppService`; it validates repo/runtime prerequisites, delegates to infra ports, updates task/workspace state, manages runtime and MCP bridge lifecycles, and emits runtime or startup events.

## Integration
Depends on `host-domain` contracts and `host-infra-system` / `host-infra-beads` adapters. This crate is the main business-logic boundary behind the Tauri host.
