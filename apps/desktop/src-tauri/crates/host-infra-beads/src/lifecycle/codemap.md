# apps/desktop/src-tauri/crates/host-infra-beads/src/lifecycle/

## Responsibility
Beads repo initialization, readiness verification, and shared-Dolt repair/provisioning.

## Design
`context`, `coordinator`, `provisioner`, `verifier`, and `error` split the lifecycle into path resolution, locking, repair/init actions, health checks, and typed failures.

## Flow
`ensure_repo_initialized_for_identity` acquires repo locks, inspects attachment/database readiness, repairs or initializes the store if required, then verifies the repo is ready.

## Integration
Uses `host_infra_system` Beads/shared-Dolt helpers and returns `host_domain::RepoStoreHealth` plus lifecycle-specific errors.
