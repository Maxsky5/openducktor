# packages/frontend/src/state/read-models/

## Responsibility

Derived read-model transforms for tasks, agent activity, and settings drafts that stay separate from direct host DTOs and presentation folders.

## Design/Patterns

Tiny pure selectors and validators normalize backend payloads before the data reaches page models or components.

## Data & Control Flow

Raw task, workspace, session, and settings draft data is filtered or shaped into user-facing read models such as visible Kanban tasks, shell agent activity summaries, reusable prompt validation maps, and normalized repo-script save payloads.

## Integration Points

`task-read-model.ts`, `agent-activity-read-model.ts`, `settings-read-model.ts`, and state/query or component modules that need canonical frontend read-model rules.
