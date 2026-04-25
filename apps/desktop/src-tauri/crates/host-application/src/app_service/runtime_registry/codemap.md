# apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_registry/

## Responsibility
Runtime registry implementation and runtime-specific adapters.

## Design
`mod.rs` defines the `AppRuntime` trait and registry container, while `open_code.rs` and `health_http.rs` provide the OpenCode runtime implementation and HTTP health/status client. Runtime setup, process lifecycle, and startup readiness now live behind the OpenCode adapter boundary.

## Flow
The service resolves a runtime kind into an `AppRuntime`, asks it for startup policy/health/status, and uses the runtime-specific adapter to start, probe, reconnect, or stop sessions.

## Integration
Connects `AppService` to `host_domain` runtime descriptors and `host_infra_system` port/process helpers.
