# apps/desktop/src-tauri/crates/

## Responsibility
Workspace-local Rust crates that implement host-domain models, the application service layer, shared command-service behavior, and infra adapters.

## Design/Patterns
Hexagonal boundaries are explicit: `host-domain` defines contracts, `host-application` orchestrates workflows, `host-command-services` owns transport-neutral command payload/service behavior, and infra crates implement ports with CLI/config/filesystem/process/beads integrations. Runtime definitions, routes, and live connections stay separate across those layers, while workspace policy/settings logic stays in the application service and config persistence stays in infra.

## Data & Control Flow
Commands, headless routes, command services, and Tauri startup depend inward on `host-application`; that crate depends on `host-domain`; infra crates implement the task store, git, config, and runtime plumbing behind those contracts without duplicating runtime capability metadata.

## Integration Points
These crates are the Rust host surface used by `src/lib.rs`, web-host handlers, and the desktop command layer.
