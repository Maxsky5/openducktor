# packages/frontend/src/state/operations/

## Responsibility
Mutation/side-effect orchestration for workspace, task, and agent-session state.

## Design Patterns
Each subfolder owns a focused mutation surface so host calls, cache invalidation, and UI-friendly side effects stay isolated.

## Data & Control Flow
Operations call host commands, update in-memory stores, and refresh React Query caches or external session stores when state changes.

## Integration Points
`workspace/`, `tasks/`, `shared/`, and `agent-orchestrator/`.
