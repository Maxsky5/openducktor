# packages/frontend/src/components/features/settings/

## Responsibility

Settings modal, repository runtime/prompt defaults, reusable prompts, configuration sections, runtime catalog defaults, and kanban/autopilot settings.

## Design/Patterns

Form sections compose focused modal hooks with shared settings read-model and save-prep helpers so the modal edits durable repo settings without mutating host state directly.

## Data & Control Flow

Settings snapshots and repo config are loaded through state queries, converted into draft state, validated, then saved back through workspace operations and query invalidation.

## Integration Points

`settings-modal.tsx`, `use-settings-modal-controller.ts`, `settings-save/`, `state/read-models/settings-read-model`, `AppShell`, and repo/workspace state operations.
