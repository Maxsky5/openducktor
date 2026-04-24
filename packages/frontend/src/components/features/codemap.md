# apps/desktop/src/components/features/

## Responsibility
Feature UI blocks shared across pages: Kanban, task details/composer, repository switching, settings, diagnostics, pull requests, and Agent Studio subpanels.

## Design Patterns
Each feature folder keeps its own model/controller hooks, presentational components, and local utility types close together.

## Data & Control Flow
Feature components accept prepared models from page hooks or state operations and emit callbacks back into those models rather than calling host APIs directly.

## Integration Points
`pages/`, `state/`, `features/`, and the UI primitives in `components/ui`.
