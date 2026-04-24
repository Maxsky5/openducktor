# apps/desktop/src-tauri/crates/host-test-support/src/

## Responsibility
Test-only environment guard utilities.

## Design
`EnvVarGuard` captures previous values for set/remove/prepend operations and restores them in `Drop`; `lock_env` serializes env-sensitive tests.

## Flow
Tests acquire the mutex, modify env vars or PATH, run assertions, and release the guard to restore prior state.

## Integration
Shared by Rust unit and integration tests that need deterministic process environment setup.
