# apps/desktop/src-tauri/crates/host-application/src/

## Responsibility
Crate root for the application service implementation and its internal module tree.

## Design
The public surface is intentionally narrow: `lib.rs` reexports `app_service` types, while the implementation stays split across focused submodules.

## Flow
Module wiring happens here; behavior lives in `app_service/*` and is consumed by the desktop host and tests.

## Integration
Sits between the Tauri entrypoint and the infra crates, exposing the APIs used by commands, headless handlers, and runtime orchestration.
