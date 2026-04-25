# apps/desktop/src-tauri/crates/host-infra-beads/

## Responsibility
Beads-backed `TaskStore` adapter and repo-store lifecycle coordinator.

## Design
`BeadsTaskStore` composes lifecycle, metadata, document, session, and task-operation helpers. Caches are local to the adapter so task queries stay cheap while remaining repo-scoped.

## Flow
TaskStore calls flow through the store implementation into Beads lifecycle verification/provisioning, then into Beads CLI commands and metadata/document writes.

## Integration
Depends on `host_domain::TaskStore` and task/document/git types, plus `host_infra_system` for repo paths, config, and shared Dolt server management.
