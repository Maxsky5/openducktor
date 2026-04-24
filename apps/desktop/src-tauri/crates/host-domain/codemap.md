# apps/desktop/src-tauri/crates/host-domain/

## Responsibility
Shared host contracts for tasks, workflow documents, git records, runtime state, and system health.

## Design
This crate stays pure and serde-friendly: enums, value objects, trait ports, and round-trip helpers live here, with no filesystem or process side effects.

## Flow
Infra adapters read/write these types, `AppService` shapes them into workflow responses, and Tauri/headless commands serialize them over IPC.

## Integration
Provides the canonical data model for `TaskStore`, `GitPort`, runtime descriptors/routes, and the task/document payloads used across the host.
