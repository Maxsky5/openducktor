# apps/desktop/src/features/git-conflict-resolution/

## Responsibility
Git-conflict resolution workflow: copy text, conflict actions, dialog UI, strip presentation, and orchestration hooks.

## Design Patterns
Conflict handling is modeled as a reusable workflow so Kanban and Agent Studio can share the same resolution decisions.

## Data & Control Flow
Conflict data is normalized into action models, then routed into dialogs or follow-up sessions depending on the task and runtime context.

## Integration Points
Kanban task approval flows, Agent Studio git panel flows, and `use-git-conflict-resolution.ts`.
