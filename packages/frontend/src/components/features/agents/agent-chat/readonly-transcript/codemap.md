# packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/

## Responsibility

Read-only session transcript surface orchestration for Agent Chat dialogs.

## Design/Patterns

The folder owns the non-composer transcript viewer model. Keep the top-level
surface hook as orchestration-only and put history loading plus pending
interaction state in focused hooks.

## Data & Control Flow

Runtime-backed transcript source inputs resolve to either an already-live
session from app state or a history-loaded transcript session, then feed the
shared `AgentChatSurface` model in non-interactive mode. Read-only transcripts
do not load active-session runtime data such as model catalogs or todos.

## Integration Points

Parent `agent-chat/` components open transcript dialogs and import the specific
transcript source type and surface hook modules they need. Runtime health warmup
remains shared at the `agents/` level.
