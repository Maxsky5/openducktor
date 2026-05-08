# apps/desktop/src-tauri/crates/host-application/

## Responsibility
Application service crate that orchestrates OpenDucktor host behavior.

## Design/Patterns
`AppService` is the main coordinator. Supporting modules cover runtime orchestration, task workflows, build orchestration, MCP bridge process/registry management, workspace policy/settings, git helpers, system checks, startup metrics, and repo-init helpers. Runtime setup is resolved through explicit runtime connections/routes rather than repo-default fallbacks, and workspace settings persistence stays explicit through the config store.

## Data & Control Flow
Commands, headless handlers, and startup code call `AppService`; it validates repo/runtime prerequisites, delegates to focused submodules, updates task/workspace state, persists repo settings and snapshots, manages runtime and MCP bridge lifecycles, and emits runtime or startup events.

## Integration Points
Depends on `host-domain` contracts and `host-infra-system` / `host-infra-beads` adapters. This crate is the main business-logic boundary behind the Tauri host and browser-backend path.
