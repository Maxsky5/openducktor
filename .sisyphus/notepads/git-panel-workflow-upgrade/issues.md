# Issues

- Rust command/config layers currently omit `defaultTargetBranch`; values sent by frontend are not persisted.
- Fallback mismatch (`main` vs `origin/main`) can produce inconsistent target branch behavior across settings and diff panel.
- No implementation blockers encountered while wiring payload/config persistence; existing repo settings merge pattern in `workspace.rs` supported the field addition cleanly.
- `bun test` diagnostics for `packages/contracts/src/runtime-schemas.test.ts` still surface a pre-existing type mismatch in an existing `runEvent` nullability test (`parsed.command`), and `bun:test` type declaration lookup can appear as an IDE diagnostic in test files even after TS compile passes.
- Rust LSP diagnostics could not run in this environment because `rust-analyzer` is not installed in the active toolchain (`stable-aarch64-apple-darwin`), so validation relied on crate tests.

- Adapter test initially failed on IPC call-order assertion for new git methods; resolved by aligning assertion order with call sequence.
- Rust LSP diagnostics remained unavailable in this environment (`rust-analyzer` missing), so command-layer validation for Task 8 was verified via AST symbol checks and `cargo test -p host-application`.
- `rust-analyzer` is still unavailable in this environment for Task 9, so verification relied on command helper tests plus `cargo test -p host-application`.
- Full desktop test output is noisy with expected React test renderer warnings and intentional error-path logs from existing suites; pass/fail confirmation should rely on package exit lines (`Exited with code 0`) rather than searching for `error:` in raw output.

- Full `bun run --filter @openducktor/desktop test` remained noisy/long-running in this environment and repeatedly hit tool timeout despite extended limits; focused panel test file passed and changed-file diagnostics are clean.
