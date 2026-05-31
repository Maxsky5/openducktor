# packages/host-client/

## Responsibility
Typed invoke-based host client exposing shell-provided host commands for workspace, task, filesystem, system, git, and runtime/build operations.

## Design Patterns
- Thin `invoke` wrappers with schema-validated inputs/outputs.
- Domain client composition keeps workspace, runtime, and task reads isolated but exposed through one host client.
- Package export surfaces stay on `src/index.ts`, which composes the host client from the underlying command clients and mirrors the package `exports` entrypoint.
- Task metadata caching dedupes host reads without hiding invalidation events.
- Workspace and task clients stay separate so freshness rules can be applied per command family.

## Data & Control Flow
`src/index.ts` composes the host client surface. `src/workspace-client.ts` handles workspace settings/configuration commands, `src/build-runtime-client.ts` routes runtime/build/task commands, and `src/task-client.ts` plus `src/task-metadata-cache.ts` manage task/document reads and freshness. The package surface is intentionally centered on `src/index.ts` so adapters and UI code consume the same typed host client.

## Integration Points
- `@openducktor/contracts` schemas and payload types
- `@openducktor/core` planner/tool types
- Shell-specific invoke bridges from Electron and Web hosts
