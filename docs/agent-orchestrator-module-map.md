# Agent Orchestrator Module Map

This is the maintainer-facing map for
`packages/frontend/src/state/operations/agent-orchestrator`.

The current design is intentionally small: persisted task records identify sessions,
runtime presence tells us which sessions are live, the event stream owns live updates,
and selected-session UI derives loading state from one selected route.

## Owners

### Repo Session Read Model

Files:

- `session-read-model/repo-session-read-model.ts`
- `lifecycle/load-sessions.ts`
- `hooks/use-repo-session-read-model-effects.ts`

Owns:

- reading persisted `TaskCard.agentSessions`
- scanning runtime presence by repo path, runtime kind, and working directory
- merging persisted records plus runtime presence into `AgentSessionState`
- subscribing to live sessions returned by runtime presence
- loading initial history only for requested sessions or live sessions with empty transcripts

Must not own:

- model catalog, slash commands, file search, diffs, or other active-session reads
- runtime startup policy
- page navigation state
- permission/question polling

### Event Stream

Files:

- `events/session-events.ts`
- `events/session-event-types.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-tool-parts.ts`

Owns:

- applying runtime events to loaded sessions
- pending permission and question updates after startup
- transcript streaming and batching
- terminal status transitions such as idle, finished, and error

Invariant: permissions and questions are fetched at startup through presence/history reads;
after that they come from runtime events. Do not add polling.

### Runtime Session References

File:

- `support/session-runtime-ref.ts`

Owns two shapes:

- route refs for listening and release: `externalSessionId`, `repoPath`,
  `runtimeKind`, `workingDirectory`
- context refs for send/reply: route fields plus durable workflow context such as
  `taskId`, `role`, optional model, and optional purpose

Do not pass prompts, task roles, or models into event subscription. A listener opens
an event stream for an existing runtime session; it is not a session start request.

### Selected Session View

Files:

- `pages/agents/agents-page-selection.ts`
- `pages/agents/use-agent-studio-selection-controller.ts`
- `components/features/agents/agent-chat/use-agent-chat-session-readiness.ts`
- `lifecycle/session-view-lifecycle.ts`
- `lifecycle/ensure-ready.ts`

Owns:

- resolving one selected candidate for the visible task
- deriving the selected route from that candidate
- deciding whether the transcript can render, should show runtime loading, should
  show session loading, or failed to load
- preparing a selected idle/stopped session before active reads or sends

Invariant: live summaries and persisted records must be combined before selection.
Do not resolve live and persisted selections in separate branches.

### Session Actions

Files:

- `handlers/start-session.ts`
- `handlers/session-actions.ts`
- `handlers/public-operations.ts`

Owns:

- start, reuse, fork, send, stop, model update, permission reply, and question reply
- persisting durable session records after starts
- rolling back failed starts
- passing route refs to listeners and context refs to runtime actions

### Readonly Runtime Transcripts

Files:

- `components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.ts`
- `components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-interactions.ts`
- `components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.ts`

Owns:

- loading a readonly transcript from runtime history
- preferring an already-loaded live session when one exists
- merging parent-observed pending permissions/questions into the local transcript view
- replying to pending input through an explicit runtime context ref

Must not own:

- opening or attaching sessions in the global orchestrator store
- runtime route resolution
- workflow session status

## Startup Flow

1. The app loads tasks from the task store.
2. `use-repo-session-read-model-effects.ts` passes all task session records to
   `loadRepoAgentSessions`.
3. `readRepoSessionPresence` scans each runtime kind and working directory once.
4. `buildRepoSessionReadModel` merges persisted records with runtime presence.
5. Live sessions are subscribed by route ref.
6. Initial history is loaded for requested sessions and live empty transcripts.
7. Subsequent status, transcript, permissions, and questions come from runtime events.

## Regression Anchors

Use these compact tests as the first-line safety net:

| Regression class | Owning test |
| --- | --- |
| Active and waiting-input sessions after reload | `session-read-model/repo-session-read-model.test.ts` |
| Runtime presence classification and idle demotion | `session-read-model/repo-session-read-model.test.ts` |
| Pending input startup snapshots without order churn or stale payloads | `session-read-model/repo-session-read-model.test.ts` |
| Running-session history baseline after reload | `lifecycle/load-sessions.test.ts` |
| User messages preserved while repo/session reads are in flight | `lifecycle/load-sessions.test.ts` |
| Per-session history failure isolation | `lifecycle/load-sessions.test.ts` |
| Stale history reads are not reported as success or failure | `lifecycle/session-history-loader.test.ts` |
| Selected-session runtime/history loading surface | `lifecycle/session-view-lifecycle.test.ts` and `components/features/agents/agent-chat/use-agent-chat-session-readiness.test.tsx` |
| Selected-session preparation and runtime recovery | `lifecycle/ensure-ready.test.ts` |
| Runtime presence projection onto session state | `lifecycle/session-presence.test.ts` |
| Permission/question replies through runtime refs | `handlers/session-actions.test.ts` |
| Event-driven permission/question lifecycle after startup | `events/session-permissions-questions.test.ts` |
| Readonly transcript loading and direct pending-input replies | `components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.test.tsx` |
| Single selected-session route across live and persisted candidates | `pages/agents/use-agent-studio-selection-controller.test.tsx` |

## Anti-Regressions

- Do not reintroduce repo hydration coordinators, presence stores, reattach stages,
  or reconciliation stages.
- Do not add runtime transcript open/attach operations to the app-state operations
  context. Readonly transcripts load local history and reply with runtime context refs.
- Do not add fallback runtime routing. Persisted sessions carry `runtimeKind` and
  `workingDirectory`; missing data is an actionable error.
- Keep runtime ids and runtime routes in low-level adapters/registry code. UI and
  page modules should carry runtime kind plus working directory, not live routes.
- Do not store live runtime routes, pending permissions, pending questions, or
  transcript stream state in task records.
- Do not make operations context carry read-model state. Read-model state has its
  own context.
- Do not split selected-session identity between a summary branch and a persisted
  record branch. Build one candidate list and resolve once.
