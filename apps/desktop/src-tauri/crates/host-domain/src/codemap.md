# apps/desktop/src-tauri/crates/host-domain/src/

## Responsibility
Implementation modules for the shared domain model: documents, git, runtime, store, system, and task.

## Design
Each submodule isolates one concern and is reexported from `lib.rs`, keeping the public API small while preserving direct access to the underlying types.

## Flow
Values are created in infra/application layers, normalized here, and then serialized back out through commands, MCP payloads, and cached app state.

## Integration
Forms the typed contract between Tauri commands, `AppService`, Beads storage, git CLI adapters, and runtime orchestration.
