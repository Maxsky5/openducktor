# apps/desktop/src-tauri/crates/host-infra-system/src/config/

## Responsibility
Application and durable runtime config persistence, normalization, migration, and workspace-record shaping.

## Design/Patterns
`store.rs` exposes `AppConfigStore` and `RuntimeConfigStore`; `types.rs` holds the schema; `normalize.rs`, `migrate.rs`, and `security.rs` enforce canonical values and secure file access. Workspace records, repo configs, runtime registry defaults, and workspace icon discovery all stay in this config boundary.

## Data & Control Flow
Config loads from disk, is permission-checked, normalized, canonicalized, and then saved atomically back to the user settings store. Workspace ordering and repo-path lookup are resolved here before higher layers read or persist settings.

## Integration Points
Feeds workspace records, runtime registry defaults, and repo settings used by `AppService` and the Beads adapter.
