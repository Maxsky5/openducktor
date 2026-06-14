# packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/

## Responsibility

Read-only session transcript surface orchestration for Agent Chat dialogs.

## Design/Patterns

The folder owns the non-composer transcript viewer model. Keep the top-level
surface hook as orchestration-only and put history loading plus pending
interaction state in focused hooks.

## Data & Control Flow

Runtime-backed transcript targets identify one runtime session with external
session id, runtime kind, and working directory. The surface resolves that
target to either an already-live session from app state or a history-loaded
transcript session, then feeds the shared `AgentChatSurface` model in
non-interactive mode. Pending runtime input is session-owned; this folder must
not merge parent-observed request copies into the transcript.
Read-only transcripts do not load active-session runtime data such as model
catalogs or todos.

`runtime-session-transcript-target.ts` owns transcript target equality and
stable target keys. Do not hand-roll externalSessionId/runtimeKind/working
directory comparisons in the hooks.

## Integration Points

Parent `agent-chat/` components open transcript dialogs with a complete
transcript target. Runtime health warmup remains shared at the `agents/` level.
