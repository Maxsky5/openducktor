# packages/host-client/src/

## Responsibility
Typed host-side clients that wrap shell-provided host commands for workspace, tasks, runtime/build, filesystem, system, and git features.

## Design Patterns
- Command-per-method wrappers with schema parsing at the boundary.
- `index.ts` is the composition root for the host client surface.
- Small utilities centralize invoke normalization, workspace-client composition, and task metadata freshness.

## Data & Control Flow
`workspace-client.ts`, `task-client.ts`, `git-client.ts`, `system-client.ts`, and `filesystem-client.ts` translate host command payloads; `build-runtime-client.ts` handles runtime/build/status flows; `task-metadata-cache.ts` dedupes reads and invalidates on repository/task changes.

## Integration Points
- `@openducktor/contracts`
- `@openducktor/core`
- Shell-specific invoke bridges from Tauri, Electron, and Web hosts
