# Issues

- Rust command/config layers currently omit `defaultTargetBranch`; values sent by frontend are not persisted.
- Fallback mismatch (`main` vs `origin/main`) can produce inconsistent target branch behavior across settings and diff panel.
- No implementation blockers encountered while wiring payload/config persistence; existing repo settings merge pattern in `workspace.rs` supported the field addition cleanly.
- `bun test` diagnostics for `packages/contracts/src/runtime-schemas.test.ts` still surface a pre-existing type mismatch in an existing `runEvent` nullability test (`parsed.command`), and `bun:test` type declaration lookup can appear as an IDE diagnostic in test files even after TS compile passes.
