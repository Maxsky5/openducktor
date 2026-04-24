# apps/desktop/src-tauri/crates/host-application/src/app_service/opencode_runtime/startup_readiness/

## Responsibility
Wait-loop and probe logic for OpenCode runtime startup readiness.

## Design
`probe_runtime.rs` owns the async TCP probe and retry policy, `wait_loop.rs` bridges the probe into blocking startup waits, and `policy.rs` defines the cancel epoch type.

## Flow
The startup path spawns a local probe, polls until the OpenCode server is reachable or times out/cancels, and returns a structured readiness report.

## Integration
Used by the OpenCode runtime launcher and surfaced through `RuntimeStartupReadinessPolicy` / `RuntimeStartupWaitReport`.
