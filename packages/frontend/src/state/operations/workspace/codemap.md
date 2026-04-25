# packages/frontend/src/state/operations/workspace/

## Responsibility
Workspace selection, branch switching, repo settings, checks, and branch-probe operations.

## Design Patterns
The workspace hook composes smaller selection/branch/probe hooks and shares a prepared switch ref so repo changes stay coordinated.

## Data & Control Flow
Workspace selection changes clear or refresh task/check/branch state, then branch probes detect external changes and degrade sync status when needed.

## Integration Points
`use-workspace-operations.ts`, `use-workspace-selection-operations.ts`, `use-workspace-branch-operations.ts`, `use-workspace-branch-probe.ts`, and repo settings/checks helpers.
