# apps/desktop/src/features/human-review-feedback/

## Responsibility
Human-review feedback workflow for rejected QA tasks and the builder follow-up message modal.

## Design Patterns
The folder keeps modal state, flow decisions, and controller logic separate from the rendered dialog.

## Data & Control Flow
Kanban or Agent Studio task context triggers the feedback flow, which captures a message and feeds the session-start workflow.

## Integration Points
`human-review-feedback-modal.tsx`, `human-review-feedback-flow.ts`, and `pages/kanban` / `pages/agents` start-session paths.
