# packages/core/

## Responsibility
Core domain services, ports, guards, workflow types, runtime-connection helpers, and prompt synthesis for agent orchestration independent of any adapter.

## Design Patterns
- Ports live in `src/ports`, orchestration helpers in `src/services`, and shared shapes in `src/types`.
- Runtime-specific behavior stays behind typed ports like `AgentEnginePort`.
- Workflow/tool policy and runtime validation are centralized for adapters and MCP layers.

## Data & Control Flow
`src/services/*` derive workflow tool selection, planner spec handling, todo mapping, runtime-connection validation, and prompts. `src/types/*` defines agent orchestrator and planner contracts, while `src/ports/*` exposes the adapter-facing agent engine contract. `src/index.ts` exports the public core surface.

## Integration Points
- Consumes `@openducktor/contracts`
- Provides `AgentEnginePort` to desktop, adapters, and orchestration layers
- Supplies workflow prompt content to host and adapter flows
