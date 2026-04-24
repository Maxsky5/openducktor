# packages/adapters-tauri-host/src/

## Responsibility

Typed host-side client modules that wrap Tauri commands for workspace, tasks, runtime/build, filesystem, system, and git features.

## Design Patterns

- Command-per-method wrappers with zod parsing on entry/exit.
- Composition root in `index.ts` binds method delegates onto one host client object.
- Small utilities (`invoke-utils.ts`, `task-metadata-cache.ts`) centralize validation and cache control.

## Data & Control Flow

- `index.ts` instantiates domain clients and exposes delegated methods to callers.
- `workspace-client.ts`, `task-client.ts`, `git-client.ts`, `system-client.ts`, and `filesystem-client.ts` each translate host command payloads.
- `build-runtime-client.ts` fans out runtime/build/status commands; `task-metadata-cache.ts` manages task metadata fetch/invalidation.

## Integration Points

- Uses `@openducktor/contracts` for schema parsing and command payload types.
- Uses `@openducktor/core` for planner tool types and shared workflow inputs/outputs.
- All calls terminate in the Tauri `invoke` bridge provided by `apps/desktop/src-tauri`.
