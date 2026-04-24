# apps/desktop/src-tauri/crates/host-infra-system/src/beads/

## Responsibility
Beads path resolution and shared-Dolt server utilities.

## Design
`repo_paths.rs` computes attachment/database locations, while `shared_dolt_server.rs` owns the shared server acquisition and lifecycle helpers.

## Flow
Callers resolve repo/workspace Beads locations, ensure the shared server is running, and restore or stop shared databases through these helpers.

## Integration
Consumed by the Beads adapter lifecycle and config layers; reexported from the infra-system crate root.
