# packages/frontend/src/pages/agents/session-start/

## Responsibility
Agent Studio session-start bridge: modal flow, fresh-session creation, and the session-specific launch helper used by the shell and Kanban flows.

## Design Patterns
This folder is a thin adapter over `features/session-start`, layering Agent Studio-specific inputs, query updates, and feedback handling onto the shared workflow.

## Data & Control Flow
Shell/page model code calls the exported flow hook, which coordinates modal decisions, session launch, kickoff messaging, and selection/query updates.

## Integration Points
`use-agent-studio-session-start-flow.ts`, `use-agent-studio-fresh-session-creation.ts`, `use-agent-studio-session-start-session.ts`, and `features/session-start`.
