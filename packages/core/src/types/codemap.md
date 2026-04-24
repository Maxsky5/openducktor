# packages/core/src/types/

## Responsibility

Shared core types for agent orchestration, runtime descriptors, planning inputs, session events, and workflow tool calls.

## Design Patterns

- Type aliases mirror contract exports to avoid divergent orchestration vocabulary.
- Scenario definitions and task actions are encoded as literal unions and lookup tables.
- Tool call unions model the supported ODT workflow mutations explicitly.

## Data & Control Flow

- `agent-orchestrator.ts` models sessions, runtime connections, user message parts, event payloads, and tool call shapes.
- `planner.ts` defines the planner-facing spec/plan inputs and `PlannerTools` interface.
- `agent-orchestrator.ts` also re-exports role/scenario helpers from `@openducktor/contracts`.

## Integration Points

- Used by `packages/core` services and ports, plus adapter implementations and UI orchestration.
- Aligns runtime/session payloads with `@openducktor/contracts` schemas.
