# apps/desktop/src/features/autopilot/

## Responsibility
Autopilot rule/event catalog for starting Planner, Builder, QA, and follow-up workflows from task state transitions.

## Design Patterns
Catalog data and rule helpers are kept pure so settings screens can derive select values, defaults, and updates deterministically.

## Data & Control Flow
Autopilot settings are read from contracts, normalized into event/action definitions, and edited through small rule-update helpers.

## Integration Points
Settings UI, task status transitions, and the workflow events defined in `@openducktor/contracts`.
