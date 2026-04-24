# apps/desktop/src-tauri/crates/host-test-support/

## Responsibility
Shared helpers for test setup, especially environment isolation.

## Design
Provides a global environment lock and `EnvVarGuard` helpers that restore state on drop, so tests can mutate PATH and other variables safely.

## Flow
Tests acquire the env lock, apply temporary env changes, then drop guards to restore the previous process environment.

## Integration
Used by Rust test suites across the host workspace; it is not part of the production host runtime.
