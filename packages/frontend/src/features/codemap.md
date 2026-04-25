# packages/frontend/src/features/

## Responsibility
Cross-cutting feature workflows that sit above page components but below app-wide state: session start, git conflict resolution, build-tools views, human-review feedback, agent git state, and autopilot catalogs.

## Design Patterns
Feature folders keep orchestration logic, small pure helpers, and exported hook/models together so pages can compose them without duplicating workflow rules.

## Data & Control Flow
Page and component models call into these features to resolve decisions, launch sessions, compute diff/git state, or normalize rule catalogs before rendering.

## Integration Points
`components/features/*`, `pages/agents`, `pages/kanban`, and `state/operations/agent-orchestrator`.
