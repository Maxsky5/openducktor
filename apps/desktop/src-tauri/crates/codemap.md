# apps/desktop/src-tauri/crates/

## Responsibility
Workspace-local Rust crates that implement host-domain models, the application service layer, infra adapters, and test support.

## Design
Hexagonal boundaries are explicit: `host-domain` defines contracts, `host-application` orchestrates workflows, and infra crates implement ports with CLI/config/filesystem/process integrations.

## Flow
Commands and Tauri startup depend inward on `host-application`; that crate depends on `host-domain`; infra crates implement the task store, git, config, and runtime plumbing behind those contracts.

## Integration
These crates are the Rust host surface used by `src/lib.rs`, browser-backend handlers, and the desktop command layer.
