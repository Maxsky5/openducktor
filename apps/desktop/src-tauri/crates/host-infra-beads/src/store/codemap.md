# apps/desktop/src-tauri/crates/host-infra-beads/src/store/

## Responsibility
Concrete `BeadsTaskStore` implementation of the `TaskStore` port.

## Design
This layer keeps the repo/workspace identity cache, then delegates real work to task/doc/session helper modules and the lifecycle coordinator.

## Flow
Each `TaskStore` method resolves the repo identity, ensures Beads readiness when needed, and forwards to the appropriate Beads CLI or metadata operation.

## Integration
Acts as the Beads adapter boundary for `host_domain` task models and `host_infra_system::AppConfigStore` workspace lookups.
