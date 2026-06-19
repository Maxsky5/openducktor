# packages/frontend/src/components/features/agents/agent-chat/readonly-transcript/

## Responsibility

Read-only session transcript surface orchestration for Agent Chat dialogs.

## Design/Patterns

The folder owns the non-composer transcript viewer model. Keep the top-level
surface hook as orchestration-only and put history loading plus pending
interaction state in focused hooks. Empty/loading/error presentation policy for
the read-only transcript lives in `runtime-transcript-surface-state.ts`, not in
the surface hook.

## Data & Control Flow

Runtime-backed transcript targets use the canonical agent session identity:
external session id, runtime kind, and working directory. The surface resolves that
target to either an already-live session from app state or a history-loaded
transcript session, then feeds the shared `AgentChatSurface` model in
non-interactive mode. Pending runtime input is session-owned; this folder must
not merge parent-observed request copies into the transcript.
Read-only transcripts do not load selected-session runtime data such as model
catalogs or todos.
`use-runtime-transcript-session-history.ts` chooses one path: matching live
session, runtime history read, or empty reason, then returns final transcript
state. The hook is also the runtime boundary that adds the selected repository
path and creates runtime refs for history queries. Do not add a separate
history-source resolver or nullable live/history/empty field bundle.

Session identity equality and stable identity keys are owned by
`lib/agent-session-identity.ts`; React hooks use
`lib/use-stable-agent-session-identity.ts` before memoizing identity-dependent
work. Do not hand-roll externalSessionId/runtimeKind/working directory
comparisons in the hooks.

## Integration Points

Parent `agent-chat/` components open transcript dialogs with a complete
transcript target. Runtime startup and health publication are owned by the app
lifecycle/checks providers; readonly transcript surfaces only consume readiness.
