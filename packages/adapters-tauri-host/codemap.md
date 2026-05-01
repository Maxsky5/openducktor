# packages/adapters-tauri-host/

## Responsibility
Typed Tauri IPC adapter exposing desktop host commands for workspace, task, filesystem, system, git, and runtime/build operations.

## Design Patterns
- Thin `invoke` wrappers with schema-validated inputs/outputs.
- Domain client composition keeps workspace, runtime, and task reads isolated but exposed through one host client.
- Task metadata caching dedupes host reads without hiding invalidation events.
- Workspace and task clients stay separate so freshness rules can be applied per command family.

## Data & Control Flow
`src/index.ts` composes the host client surface. `src/workspace-client.ts` handles workspace settings/configuration commands, `src/build-runtime-client.ts` routes runtime/build/task commands, and `src/task-client.ts` plus `src/task-metadata-cache.ts` manage task/document reads and freshness.

## Integration Points
- `@openducktor/contracts` schemas and payload types
- `@openducktor/core` planner/tool types
- Tauri `invoke` bridge from the desktop shell/host
