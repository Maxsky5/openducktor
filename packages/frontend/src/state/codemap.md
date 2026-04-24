# apps/desktop/src/state/

## Responsibility
Application state and host orchestration. This layer owns workspace/task/runtime query access, mutation services, app providers, and agent-session lifecycle state.

## Design Patterns
React Query for backend-owned reads, context providers for long-lived slices, external stores for live agent sessions, and dedicated operation modules for mutations/side effects.

## Data & Control Flow
Providers compose workspace/checks/tasks/spec/delegation/agent-session slices. Queries read from the host; operations mutate host state and invalidate or refresh query caches.

## Integration Points
`app-state-provider.tsx`, `queries/`, `operations/`, `providers/`, `lifecycle/`, `read-models/`, and `tasks/` error/normalization helpers.
