# packages/core/src/types/

## Responsibility
Shared core types for agent orchestration, runtime descriptors, planning inputs, session events, and workflow tool calls.

## Design Patterns
- Type aliases mirror contract exports to avoid divergent orchestration vocabulary.
- Scenario definitions and task actions use literal unions and lookup tables.
- Tool-call unions model supported ODT workflow mutations explicitly.

## Data & Control Flow
`agent-orchestrator.ts` models sessions, runtime connections, event payloads, and tool-call shapes. `planner.ts` defines planner-facing spec/plan inputs and `PlannerTools`.

## Integration Points
- Used by `packages/core` services and ports, plus adapter implementations and UI orchestration
- Aligned with `@openducktor/contracts` schemas
