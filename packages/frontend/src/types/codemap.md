# packages/frontend/src/types/

## Responsibility
Shared TypeScript contracts for the desktop app: app-state slices, orchestrator/session models, browser-live events, task documents, diagnostics, and exported constants.

## Design Patterns
Centralized type barrels and discriminated unions. Runtime/session/task shapes are defined once and reused by components, state, feature helpers, and orchestrator runtime models.

## Data & Control Flow
These types describe data moving between the host, React Query, page models, and session orchestration hooks; they keep UI and adapter code aligned, including runtime transcript and permission overlays.

## Integration Points
`agent-orchestrator.ts`, `state-slices.ts`, `task-documents.ts`, `browser-live.ts`, `diagnostics.ts`, `runtime.ts`, and the `@openducktor/contracts` / `@openducktor/core` boundaries.
