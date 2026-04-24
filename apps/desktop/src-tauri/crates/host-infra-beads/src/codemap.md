# apps/desktop/src-tauri/crates/host-infra-beads/src/

## Responsibility
Implementation details for the Beads adapter: command execution, lifecycle coordination, metadata parsing, normalization, and store orchestration.

## Design
The crate is split into focused modules for command runner abstraction, constants, document storage, lifecycle, metadata/model parsing, and store helpers.

## Flow
`BeadsTaskStore` reads and writes Beads metadata, while `BeadsLifecycle` ensures repo readiness and shared-Dolt availability before task operations run.

## Integration
Used by the application service through `host_infra_beads::BeadsTaskStore` and by `host_infra_system` utilities for Beads paths and server state.
