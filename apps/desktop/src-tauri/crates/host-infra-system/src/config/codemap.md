# apps/desktop/src-tauri/crates/host-infra-system/src/config/

## Responsibility
Application and runtime config persistence, normalization, and migration.

## Design
`store.rs` exposes `AppConfigStore` and `RuntimeConfigStore`; `types.rs` holds the schema; `normalize.rs`, `migrate.rs`, and `security.rs` enforce canonical values and secure file access.

## Flow
Config loads from disk, is permission-checked, normalized, canonicalized, and then saved atomically back to the user settings store.

## Integration
Feeds workspace records, runtime registry defaults, and repo settings used by `AppService` and the Beads adapter.
