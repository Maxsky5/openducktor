# packages/frontend/src/components/features/settings/

## Responsibility

Settings modal, repository runtime/prompt defaults, reusable prompts, configuration sections, runtime catalog defaults, and kanban/autopilot settings.

## Design/Patterns

Form sections compose focused modal models with shared settings read-model helpers so the modal can edit durable repo settings without mutating host state directly.

## Flow

Settings snapshots and repo config are loaded through state queries, converted into draft state, then saved back through workspace operations and query invalidation.

## Integration

`settings-modal.tsx`, `settings-modal-model.ts`, `state/read-models/settings-read-model`, `AppShell`, and repo/workspace state operations.
