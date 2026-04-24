# packages/adapters-tauri-host/

## Responsibility

Tauri IPC adapter that exposes desktop host commands as typed clients for workspace, task, filesystem, system, git, and runtime/build operations.

## Design Patterns

- Thin typed client wrappers around `invoke`.
- Schema-validated request/response translation at every IPC boundary.
- Shared task metadata cache to dedupe host reads and preserve freshness semantics.

## Data & Control Flow

- `src/index.ts` composes the per-domain clients into a single `TauriHostClient` surface.
- `src/build-runtime-client.ts` routes runtime/build/task/agent commands into host invocations.
- `src/task-client.ts` and `src/task-metadata-cache.ts` coordinate task reads, document reads, and invalidation.

## Integration Points

- Consumes `@openducktor/contracts` schemas for every host payload.
- Consumes `@openducktor/core` planner tools for the merged host API surface.
- Expects Tauri `invoke` transport provided by the desktop frontend/host bridge.
