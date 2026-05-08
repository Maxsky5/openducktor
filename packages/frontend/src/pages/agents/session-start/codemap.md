# packages/frontend/src/pages/agents/session-start/

## Responsibility

Agent Studio session-start bridge for modal flow, runtime selection, reuse-state handling, fresh-session creation, kickoff prompt dispatch, and query/session updates.

## Design/Patterns

This folder is a thin adapter over `features/session-start`, layering Agent Studio-specific inputs, selection updates, and feedback handling onto the shared workflow.

## Data & Control Flow

Shell/page model code calls the exported flow hook, which coordinates modal decisions, runtime selection, reuse state, session launch, kickoff messaging, and selection/query updates.

## Integration Points

`use-agent-studio-session-start-flow.ts`, `use-agent-studio-session-start-session.ts`, `use-agent-studio-fresh-session-creation.ts`, `use-agent-studio-session-action-helpers.ts`, and `features/session-start`.
