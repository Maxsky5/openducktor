# packages/core/src/

## Responsibility
Core agent workflow logic: ports, runtime guards, role/tool policies, planner helpers, prompt builders, and task/session mapping utilities.

## Design Patterns
- Pure, adapter-agnostic domain services.
- Type aliases mirror contract types to keep orchestration boundaries aligned.
- Centralized guards enforce fail-fast runtime and workspace assumptions.

## Data & Control Flow
`ports/agent-engine.ts` defines the agent-session, runtime-registry, and workspace-inspection contract. `services/*` shape workflow authorization, runtime-connection validation, planner persistence, prompt synthesis, and todo mapping. `types/*` define orchestrator inputs/outputs, runtime descriptors, and tool-call models.

## Integration Points
- Used by `packages/adapters-opencode-sdk`, `packages/adapters-tauri-host`, and `packages/openducktor-mcp`
- Re-exported from `src/index.ts`
