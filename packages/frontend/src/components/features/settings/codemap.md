# packages/frontend/src/components/features/settings/

## Responsibility
Settings modal, repository runtime/prompt defaults, configuration sections, runtime catalog defaults, kanban/autopilot settings, and validation helpers.

## Design Patterns
Form sections are broken into focused models and normalization helpers so the modal can edit durable repo settings without mutating host state directly.

## Data & Control Flow
Settings snapshots and repo config are loaded through state queries, converted into draft state, then saved back through workspace operations and query invalidation.

## Integration Points
`settings-modal.tsx`, `settings-model.ts`, `settings-modal-model.ts`, `AppShell`, and repo/workspace state operations.
