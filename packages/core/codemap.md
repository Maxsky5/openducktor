# packages/core/

## Responsibility

Core domain services, ports, guards, workflow types, and prompt synthesis for agent orchestration independent of any host/runtime adapter.

## Design Patterns

- Port-and-service split: interfaces in `src/ports`, orchestration helpers in `src/services`, shared shapes in `src/types`.
- Core logic delegates all runtime-specific calls through typed ports such as `AgentEnginePort`.
- Workflow/tool policy is centralized and reused by adapters and MCP layers.
- Agent prompt templates stay in core so host-specific shells only inject data, not policy text.

## Data & Control Flow

- `src/index.ts` exports the public core surface.
- `src/services/*` derive workflow tool selections, planner spec handling, todo mapping, runtime connection validation, and agent system/kickoff/message prompts.
- `src/types/*` defines agent orchestrator and planner contracts consumed by adapters and UI code.

## Integration Points

- Consumes `@openducktor/contracts` for runtime/task schema types.
- Provides `AgentEnginePort` to the desktop app, adapters, and orchestration layers.
- Supplies workflow prompt content consumed by the host, adapters, and agent orchestration flows.
