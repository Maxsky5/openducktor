# packages/frontend/src/features/session-start/

## Responsibility
Shared session-start workflow: modal decisions, runtime selection, reuse/fresh/fork launch logic, kickoff prompts, and scenario resolution.

## Design Patterns
Decision-making is centralized here so pages can ask for a launch request and get back a consistent session-start outcome plus reuse-state intent.

## Data & Control Flow
Requests are converted into modal decisions, then executed into a launch workflow that may reuse an existing session, attach the selected runtime, or start a fresh one.

## Integration Points
`pages/agents/session-start`, `pages/kanban`, `human-review-feedback`, and `state/operations/agent-orchestrator` session creation.
