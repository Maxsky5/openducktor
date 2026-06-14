# Agent Orchestrator Module Map

This is the maintainer-facing map for
`packages/frontend/src/state/operations/agent-orchestrator`.

The current design is intentionally small: persisted task records identify sessions,
runtime presence tells us which sessions are live, the event stream owns live updates,
and selected-session UI derives loading state from one selected route.

## Owners

### Repo Session Projection

Files:

- `session-read-model/repo-session-read-model.ts`
- `hooks/use-repo-session-read-model-effects.ts`

Owns:

- reading persisted task session records supplied by the task-session-record query
- scanning runtime presence by repo path, runtime kind, and working directory
- merging persisted records plus runtime presence into `AgentSessionState`
- returning runtime session refs that should be observed

Invariant: missing runtime presence means the runtime did not report the session
as live. The projection keeps durable session identity plus already loaded
transcript history, but it must not preserve live-only status, pending input, or
streaming state without runtime presence. Runtime events own live state only
after presence proves the session is live and a listener is running.

Must not own:

- model catalog, slash commands, file search, diffs, or other active-session reads
- runtime startup policy
- page navigation state
- history target selection or history loading
- permission/question polling

### Session History Loading

Files:

- `lifecycle/load-sessions.ts`
- `lifecycle/session-history-loader.ts`
- `lifecycle/session-history-read-model-loader.ts`
- `lifecycle/session-history-runtime-context.ts`

Owns:

- observing projected runtime session refs
- selecting history loads for requested sessions or observed sessions whose
  history has not been requested
- deciding when a selected session should retry or start its history load
- passing transient runtime prompt context to history loads without storing it in
  session state
- merging runtime history into transcript messages without erasing live messages

### Event Stream

Files:

- `events/session-events.ts`
- `events/session-event-types.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-tool-parts.ts`

Owns:

- applying runtime events to loaded sessions
- routing runtime todo events into the selected-session runtime-data writer
- pending permission and question updates after startup
- transcript streaming and batching
- terminal status transitions such as idle, finished, and error

Invariant: permissions and questions are fetched at startup through presence/history reads;
after that they come from runtime events. Do not add polling.
Invariant: a pending permission or question belongs to exactly one `AgentSessionState`.
Parent subagent rows may link to child session ids in message metadata, but they must
not copy child pending input.

### Assistant Turn Timing

Files:

- `hooks/use-agent-session-turn-timing.ts`
- `hooks/use-orchestrator-session-state.ts`
- `support/assistant-turn-duration.ts`

Owns:

- user-message anchor timestamps for pending sends and permission/question replies
- assistant activity start timestamps from runtime status and part events
- previous assistant completion timestamps used to bound duration calculations
- duration resolution for assistant transcript metadata

Invariant: timing state is one workspace-scoped map keyed by external session id.
Do not reintroduce per-field timing refs, proxy bridges, or duplicate timestamp
stores in event handlers.

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
- `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`
- `pages/agents/selected-session/selected-session-context.ts`
- `components/features/agents/agent-chat/agent-chat-thread-context.ts`
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

Invariant: selected-session lifecycle owns transcript rendering state derived
from runtime readiness and history load state. History loading policy and
runtime-data query gating live in their owner modules, not in the lifecycle
model. Page route/task switching is orchestration state and must not be stored
in the lifecycle model.

Invariant: subagent waiting badges are derived from child session summaries.
Selected-session state must not maintain parent-owned pending-input projections.

### Selected Session Runtime Data

Files:

- `hooks/use-session-runtime-data.ts`
- `support/session-runtime-data-plan.ts`
- `support/session-runtime-data-writer.ts`
- `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`

Owns:

- deciding whether the selected session has enough stable runtime context to read runtime data
- reading selected-session model catalog and todos through TanStack Query
- owning live todo state through the same todos query cache used for selected-session reads
- reporting selected-session runtime-data read errors
- providing view-only runtime data to Agent Studio

Must not own:

- `AgentSessionState` identity, status, transcript messages, or history load state
- canonical session todos; todos are runtime data, not session state
- task session records
- runtime route resolution

Invariant: runtime-data reads and runtime todo events must not rewrite the session
store. Agent Studio may compose a chat thread session from raw
`AgentSessionState` plus selected-session runtime data at the presentation
boundary, but lifecycle decisions must use the raw selected `AgentSessionState`.

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
- reading pending permissions/questions from the live session when one exists
- replying to pending input through an explicit runtime context ref

Must not own:

- opening or attaching sessions in the global orchestrator store
- runtime route resolution
- workflow session status
- parent-observed copies of pending permissions/questions

### Task Session Records

Files:

- `state/queries/agent-sessions.ts`
- `state/operations/agent-orchestrator/session-read-model/task-session-records.ts`

Owns:

- reading durable task session records from the host
- seeding per-task session-record query caches after bulk reads
- presenting task session history to Agent Studio, Kanban, task details, and autopilot

Must not own:

- live runtime status
- transcript messages
- runtime route resolution

Invariant: UI decisions must not read session history from `TaskCard.agentSessions`.
Use task session record queries instead, so task cards remain task summaries and
session history has one frontend read boundary.

## Startup Flow

1. The app loads tasks from the task store.
2. `use-repo-session-read-model-effects.ts` passes all task session records to
   `loadRepoAgentSessions`.
3. Persisted session records remain route candidates while runtime presence is checked.
4. `readRepoRuntimeSessionPresence` scans each runtime kind and working directory once.
5. `buildRepoSessionReadModel` commits session state once presence is known; missing runtime evidence is `missing`.
6. Live sessions are observed by route ref. The session observer asks the runtime
   adapter to subscribe; the adapter owns any runtime-side state preparation
   needed before events can flow.
7. Initial history is loaded from materialized session state for requested
   sessions and live sessions whose history has not been requested. Each history
   load receives transient runtime prompt context through the shared history
   context builder; prompt text is never copied into session state.
8. Subsequent status, transcript, permissions, and questions come from runtime events.

## Regression Anchors

Use these compact tests as the first-line safety net:

| Regression class | Owning test |
| --- | --- |
| Active and waiting-input sessions after reload | `session-read-model/repo-session-read-model.test.ts` |
| Runtime presence classification and idle demotion | `session-read-model/repo-session-read-model.test.ts` |
| Pending input startup snapshots without order churn or stale payloads | `session-read-model/repo-session-read-model.test.ts` |
| Running-session history baseline after reload | `lifecycle/load-sessions.test.ts` |
| Runtime prompt context for startup history loads | `use-agent-orchestrator-operations.session-state.test.tsx` |
| User messages preserved while repo/session reads are in flight | `lifecycle/load-sessions.test.ts` |
| Per-session history failure isolation | `lifecycle/load-sessions.test.ts` |
| Stale history reads are not reported as success or failure | `lifecycle/session-history-loader.test.ts` |
| Selected-session runtime/history loading surface | `lifecycle/session-view-lifecycle.test.ts`, `pages/agents/use-agent-studio-page-models.test.tsx`, and `components/features/agents/agent-chat/agent-chat-thread-context.test.ts` |
| Runtime preparation failures before session start | `lifecycle/ensure-ready.test.ts` |
| Runtime presence projection onto session state | `lifecycle/session-presence.test.ts` |
| Permission/question replies through runtime refs | `handlers/session-actions.test.ts` |
| Event-driven permission/question lifecycle after startup | `events/session-permissions-questions.test.ts` |
| Readonly transcript loading and direct pending-input replies | `components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.test.tsx` |
| Single selected-session route across live and persisted candidates | `pages/agents/use-agent-studio-selection-controller.test.tsx` |

## Anti-Regressions

- Do not reintroduce repo hydration coordinators, presence stores, reattach stages,
  or reconciliation stages.
- Do not make the repo session read model prepare runtime sessions. It may
  project persisted records plus presence snapshots and hand live refs to the
  session observer only.
- Do not make the repo session read model select transcript/history load
  targets. Session history loading owns that policy.
- Do not add runtime transcript open/attach operations to the app-state operations
  context. Readonly transcripts load local history and reply with runtime context refs.
- Do not load selected transcript history by refetching task session records.
  The selected session state already owns runtime kind, working directory, role,
  and selected model for history reads.
- Do not create separate history-loading paths for repo startup and selected
  sessions. They must share the same transient prompt-context boundary.
- Do not add fallback runtime routing. Persisted sessions carry `runtimeKind` and
  `workingDirectory`; missing data is an actionable error.
- Keep runtime ids and runtime routes in low-level adapters/registry code. UI and
  page modules should carry runtime kind plus working directory, not live routes.
- Do not store live runtime routes, pending permissions, pending questions, or
  transcript stream state in task records.
- Do not add parent-session pending-input overlays for subagents. Child sessions
  own pending requests; parent rows only link to child session ids.
- Do not make operations context carry read-model state. Read-model state has its
  own context.
- Do not split selected-session identity between a summary branch and a persisted
  record branch. Build one candidate list and resolve once.
