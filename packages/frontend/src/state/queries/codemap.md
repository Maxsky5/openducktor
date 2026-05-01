# packages/frontend/src/state/queries/

## Responsibility
Typed React Query adapters for workspace, tasks, runtime catalog, agent-session runtime, documents, checks, git, agent sessions, filesystem, and dev-server reads.

## Design Patterns
Query key builders and `queryOptions()` factories live here; imperative loaders use the shared `QueryClient` helpers to hydrate or refresh cache entries.

## Data & Control Flow
Host reads are normalized here, then consumed by pages/components through `useQuery` or imperative preload paths. Mutations elsewhere invalidate these keys, especially runtime catalog, session model catalog/todo, and agent-session runtime lookups.

## Integration Points
`workspace.ts`, `tasks.ts`, `runtime.ts`, `documents.ts`, `checks.ts`, `git.ts`, `agent-sessions.ts`, `agent-session-runtime.ts`, and the host client/query client.
