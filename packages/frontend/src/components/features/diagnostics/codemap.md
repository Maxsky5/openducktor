# packages/frontend/src/components/features/diagnostics/

## Responsibility
Health/status diagnostics UI for workspace, beads, and runtime checks.

## Design Patterns
Panel/section split: model hooks reduce raw check data into display rows and section groups.

## Data & Control Flow
Workspace checks and runtime health snapshots are transformed into user-facing statuses, then rendered in the sidebar or settings surfaces.

## Integration Points
`state/queries/checks`, `state/providers`, and the main app shell sidebar.
