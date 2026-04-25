# packages/core/src/

## Responsibility

Core agent workflow logic: ports, runtime guards, role/tool policies, planner helpers, prompt builders, and task/session mapping utilities.

## Design Patterns

- Domain services are pure and adapter-agnostic.
- Type aliases mirror contract types to keep runtime and orchestration boundaries aligned.
- Centralized guards enforce fail-fast runtime connection and workspace assumptions.

## Data & Control Flow

- `ports/agent-engine.ts` defines the operations that adapters must implement for agent sessions and workspace inspection.
- `services/*` shape workflow tool authorization, runtime connection validation, planner spec persistence, prompt synthesis, and todo mapping.
- `types/*` define agent orchestrator inputs/outputs plus planning/task action model types.

## Integration Points

- Used by `packages/adapters-opencode-sdk`, `packages/adapters-tauri-host`, and `packages/openducktor-mcp`.
- Re-exports form the package API from `src/index.ts`.
