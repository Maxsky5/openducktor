# packages/frontend/src/features/session-start/

## Responsibility

Shared session-start workflow: modal decisions, runtime selection, reuse/fresh/fork launch execution, kickoff prompts, and launch-action resolution.

## Design/Patterns

Decision-making is centralized in pure workflow helpers and hook runners so page adapters only supply context-specific inputs.

## Data & Control Flow

Requests are converted into modal decisions, then executed into a launch workflow that may reuse an existing session, attach the selected runtime, or start a fresh one.

## Integration Points

`session-start-workflow.ts`, `session-start-orchestration.ts`, `session-start-execution.ts`, `use-session-start-modal-*`, `session-start-modal-*`, `pages/agents/session-start`, `pages/kanban`, and `human-review-feedback`.
