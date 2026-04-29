# packages/adapters-tauri-host/src/

## Responsibility
Typed host-side clients that wrap Tauri commands for workspace, tasks, runtime/build, filesystem, system, and git features.

## Design Patterns
- Command-per-method wrappers with schema parsing at the boundary.
- `index.ts` is the composition root for the host client surface.
- Small utilities centralize invoke normalization and task metadata freshness.

## Data & Control Flow
`workspace-client.ts`, `task-client.ts`, `git-client.ts`, `system-client.ts`, and `filesystem-client.ts` translate Tauri command payloads; `build-runtime-client.ts` handles runtime/build/status flows; `task-metadata-cache.ts` dedupes reads.

## Integration Points
- `@openducktor/contracts`
- `@openducktor/core`
- Tauri `invoke` bridge from `apps/desktop/src-tauri`
