# Agent Orchestrator Module Map

This is the maintainer-facing map for
`packages/frontend/src/state/operations/agent-orchestrator`.

The current design is intentionally small: persisted task records identify sessions,
runtime snapshots tell us which sessions are live, the event stream owns live updates,
and selected-session UI derives loading state from one selected route.

Workspace records are a UI/app-state concern. Session modules below
`useAgentOrchestratorOperations` receive the primitive identity they need:
`workspaceRepoPath` for repo-scoped session state, and `workspaceId` only when
prompt/runtime startup code needs repository configuration. Do not pass
`ActiveWorkspace` into transcript-state, session action, or read-model modules.

## Owners

### Agent Session Store

Files:

- `packages/frontend/src/state/agent-sessions-store.ts`
- `hooks/use-orchestrator-session-state.ts`
- `support/local-session-removal.ts`

Owns:

- the current in-memory `AgentSessionState` collection for the active workspace
- derived session summaries and activity summaries
- notifying React subscribers when the collection changes

Invariant: `AgentSessionsStore` is the only in-memory owner for loaded
sessions. Session observation receives store operations such as `readSession`,
`hasSession`, and `updateSession`; it must not receive or inspect the mutable
collection bridge.
Hooks should expose the store, not duplicate collection getters.
Transient event state is held in explicit named refs; do not reintroduce a
generic mutable-state bridge that hides which concept owns which value.
`useAgentOrchestratorOperations` owns the session commit callback that writes to
`AgentSessionsStore` and optionally persists durable workflow records. Do not
split this into a single-use mutation hook.
Observer cleanup and runtime event handlers must read from `AgentSessionsStore`,
and session removal must remove through
`AgentSessionsStore.setSessionCollection`, not direct ref reads.
Local session removal must stay atomic: removing a session from the store,
removing its observer, and clearing transient draft/turn state are one operation
owned by `support/local-session-removal.ts`.
Repo session read-model refreshes should read the current collection through
the session store snapshot reader, never through the mutable event-stream bridge.
Session history loading, session preparation, and start/reuse policies should read
one current session through the store snapshot reader; they must not inspect a
mutable collection snapshot directly.
UI start flows such as Kanban receive session summaries as render snapshots;
they must not create mutable session mirrors to make callbacks look stable.

Must not own:

- persisted task session records
- runtime snapshots
- selected-session history-load policy
- live runtime routes

### Session Activity State

Files:

- `packages/frontend/src/lib/agent-session-activity-state.ts`
- `packages/frontend/src/lib/agent-session-waiting-input.ts`

Owns:

- deriving product-facing session activity from raw status and pending input
- the precedence rule that pending questions or approvals beat raw starting/running/idle status
- the shared `waiting_input`, `starting`, `running`, `idle`, `stopped`, and `error`
  UI activity vocabulary

Invariant: UI surfaces such as Agent Studio tabs, Kanban activity, active-session
sidebars, selected-session action state, and transcript surfaces must use this
owner instead of recomputing raw status plus pending-input checks. Session
selection receives full `AgentSessionSummary` objects; it must not accept
persisted task-session records or optional pending-input fields.
`AgentSessionsStore` activity snapshots publish this derived `activityState`
directly; shell/activity read models must not receive pending-input booleans and
rebuild the precedence rule.
Session summaries publish `activityState` plus pending-input counts only; the
pending approval/question payloads stay on the live `AgentSessionState`.

Must not own:

- runtime snapshot classification
- event-stream pending-input mutation
- durable task-session record reconstruction

### Repo Session Projection

Files:

- `lifecycle/load-sessions.ts`
- `session-read-model/repo-session-read-model.ts`
- `hooks/use-repo-session-read-model-effects.ts`

Owns:

- reading persisted task session records supplied by the task-session-record query
- scanning runtime snapshots by repo path, runtime kind, and working directory
- merging persisted records plus runtime snapshots into `AgentSessionState`
- returning live runtime session refs

Invariant: a missing runtime snapshot means the runtime did not report the session
as live. When rebuilding from persisted records without a mounted session, the
projection starts from durable session identity only and must not invent
live-only status, pending input, or streaming state. When a matching mounted
session already exists, a missing snapshot is absence of runtime evidence, not
an idle event; it must not demote the mounted session or clear current pending
input, draft output, or pending user sends.
Runtime events own live state only after the runtime snapshot proves the session
is live and an observer is running.

Must not own:

- model catalog, slash commands, file search, diffs, or other active-session reads
- runtime startup policy
- page navigation state
- history target selection or history loading
- permission/question polling

### Runtime Readiness

Files:

- `packages/frontend/src/state/queries/checks.ts`
- `packages/frontend/src/state/operations/workspace/use-checks.ts`
- `packages/frontend/src/lib/repo-runtime-health.ts`
- `packages/frontend/src/lib/use-repo-runtime-readiness.ts`
- `packages/host/src/application/runtimes/runtime-orchestrator-service.ts`

Owns:

- reading runtime health for the active repository through TanStack Query
- asking the host for `repoRuntimeHealth`
- reporting runtime-starting, ready, blocked, and error readiness states

Invariant: `repoRuntimeHealth` is the only repository-load readiness path that
may ensure a workspace runtime before probing runtime health or MCP status.
App lifecycle and workspace selection must not start runtimes or manually
refresh runtime health as a side effect; selecting a workspace only makes the
runtime-health query eligible to run.

Must not own:

- session start/send runtime preparation
- selected-session history loading
- transcript rendering state
- runtime route resolution for a concrete session action

### Session History Loading

Files:

- `history/session-history-loader.ts`
- `support/session-prompt.ts`

Owns:

- deciding when a selected session should retry or start its history load
- claiming, applying, failing, and releasing session history load state
- building transient runtime prompt context through the shared prompt helper and
  passing it to history loads without storing it in session state
- merging runtime history into transcript messages without erasing live messages

Invariant: history loading is explicit and singular. The selected session view or
session action asks to load one concrete session route; the repo projection never
bulk-loads transcripts.
The loader receives a store-backed `readSessionSnapshot` dependency and must not
read mutable collection snapshots directly.

Invariant: transcript storage is owned by the session message helpers. UI chat
models receive a `SessionMessagesState` handle; raw message arrays may be
normalized at boundaries but must not leak into transcript rendering.

### Event Stream

Files:

- `events/session-events.ts`
- `events/session-event-types.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-pending-input-routing.ts`
- `events/session-subagent-links.ts`
- `events/session-tool-parts.ts`
- `support/session-transient-state.ts`

Owns:

- applying runtime events to loaded sessions
- routing runtime todo events into the selected-session runtime-data writer
- pending permission and question updates after startup
- transcript streaming and batching
- terminal status transitions such as idle, finished, and error
- transient assistant draft buffers for streaming reasoning text

Invariant: permissions and questions are fetched at startup through runtime snapshot/history reads;
after that they come from runtime events. Do not add polling.
Invariant: event handlers consume narrow runtime policies only. Runtime descriptor
lookup is owned by the observer boundary; do not pass runtime descriptors or
definition resolvers into event handlers.
Invariant: a pending permission or question belongs to exactly one `AgentSessionState`.
Parent subagent rows may link to child session ids in message metadata, but they must
not copy child pending input.
Pending-input ownership and approval reply routing live in
`events/session-pending-input-routing.ts`; subagent row link patching lives in
`events/session-subagent-links.ts`. The pending-input event handler applies the
route and mutates pending state, but must not reimplement parent/child routing.
Invariant: draft buffers live behind `SessionTransientState.draftBuffers`. Do not
pass raw draft maps or timeout refs through observer/event boundaries.
Invariant: active-turn model and context-usage message anchors live behind
`SessionTransientState.turnMetadata`. Event handlers may record/read/clear that owner,
but must not pass raw per-session maps or refs through observer/event boundaries.
Invariant: event batching is only a local coalescing/throttling policy for noisy
runtime stream events. It must not grow into session reconciliation, history
loading, polling, or runtime readiness logic.

### Assistant Turn Timing

Files:

- `hooks/use-orchestrator-session-state.ts`
- `support/assistant-turn-duration.ts`
- `support/session-transient-state.ts`

Owns:

- user-message anchor timestamps for pending sends and permission/question replies
- assistant activity start timestamps from runtime status and part events
- previous assistant completion timestamps used to bound duration calculations
- duration resolution for assistant transcript metadata

Invariant: timing state lives behind the `SessionTransientState.assistantTurnTiming`
store. Do not expose the raw map, reintroduce a React timing hook, add proxy bridges,
or duplicate timestamp stores in event handlers.

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
- `components/features/agents/agent-chat/use-agent-chat-surface-model.ts`
- `transcript/session-transcript-state.ts`
- `lifecycle/ensure-ready.ts`

Owns:

- resolving one selected candidate for the visible task
- deriving the selected route from that candidate
- deciding whether the transcript can render, should show runtime loading, should
  show session loading, or failed to load
- preparing a selected idle/stopped session before active reads or sends

Invariant: live summaries and persisted records must be combined before selection.
Do not resolve live and persisted selections in separate branches.

Invariant: selected-session transcript state owns transcript rendering state
derived from runtime readiness and history load state. History loading policy and
runtime-data query gating live in their owner modules, not in the transcript
state model. Page route/task switching is orchestration state and must not be
stored in the transcript state model. Do not mirror runtime readiness on it.
Readonly transcript surfaces pass direct facts into the transcript-state owner:
whether a transcript is visible, whether a history target exists, and whether
the history read failed. They must not synthesize session-shaped history
snapshots or maintain a separate transcript loading state machine.
Readonly transcript surfaces resolve their live-session/history-session target
through `readonly-transcript/runtime-transcript-history-target.ts`; hooks must not
inline that selection logic.
Readonly transcript presentation state is derived in
`readonly-transcript/runtime-transcript-surface-state.ts`; hooks must not inline
empty/loading/error or displayed-session working-state policy.
Agent chat renderable-thread projection, transcript notice copy, and
reset-window policy are derived in `agent-chat/agent-chat-thread-state.ts`;
surface hooks and rendering components must not interpret transcript state
directly or pass a separate transcript-pending boolean beside transcript state.
Agent chat types must reference the canonical selected-session transcript state and
repo-runtime readiness contracts instead of declaring local lookalike shapes.
Selected-session transcript state is the source of truth for transcript loading. Shell,
right-panel, and build-tool modules may derive edge booleans from
`viewTranscriptState`, but central selection must not expose a second
`isSessionViewLoading` field.
Repo-session read-model loading is exposed as one
`sessionReadModelLoadState` value. Do not split it back into independent
loading and error fields; selected-session transcript state is the only place that
interprets read-model load state against runtime readiness and route selection.
The transcript-state module exposes selected-session and runtime transcript-state
derivation only; do not add parallel session-source or target state helpers.

Invariant: subagent waiting badges are derived from child session summaries.
Selected-session state must not maintain parent-owned pending-input projections.

### Selected Session Runtime Data

Files:

- `hooks/use-session-runtime-data.ts`
- `support/session-runtime-data-target.ts`
- `state/queries/agent-session-runtime.ts`
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
Runtime events update todos through `updateSessionTodosQueryData`; do not
reintroduce a writer object or pass a second session route through event context.
Runtime-data query keys, unavailable keys, stale windows, and disabled-target
fail-fast behavior live in `state/queries/agent-session-runtime.ts`; the selected
session runtime-data target owns read eligibility and stable runtime/session
refs. The React hook owns only query wiring and view composition.

### Agent Chat Composer

Files:

- `pages/agents/agent-studio-chat-surface-state.ts`
- `pages/agents/chat-composer/use-agent-studio-chat-composer.ts`
- `features/agent-chat-composer/context-usage/use-active-session-context-usage.ts`
- `features/agent-chat-composer/prompt-input/chat-composer-prompt-input-target.ts`
- `features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands.ts`
- `features/agent-chat-composer/prompt-input/use-chat-composer-skills.ts`

Owns:

- composing model-selection choices for a new message or new session
- deriving Agent Studio chat empty-state/kickoff visibility and composer
  read-only state
- keeping selected-session target identity and selected-model fallback available
  while the full selected session is still loading
- deriving context usage from the loaded session's live context usage and messages
- resolving the single prompt-input target directly from the loaded session,
  selected session summary, repo runtime selection, and unavailable runtime
  context

Must not own:

- selected-session transcript loading state
- canonical session status, messages, pending input, or history load state
- runtime route resolution beyond the already-derived working-directory ref

Invariant: a session summary may identify the selected target and selected model,
but it must not provide loaded-session status, messages, or context usage.
Session-scoped slash-command and skill reads require a loaded session; summary-only
targets are loading targets, not live-session state. Slash commands, skills, and
file search must consume the shared prompt-input target instead of recomputing
session/repo/loading/runtime-error booleans independently.

Invariant: Agent Studio chat surface state receives selected-session transcript state
and already-computed start availability. It must not recompute task workflow
availability or runtime readiness.
The generic chat composer may receive an already-computed waiting-input
placeholder string, but it must not receive pending approval/question payloads or
derive pending-input copy from `AgentSessionState`.

Invariant: prompt-input capability helpers receive one already-selected runtime
kind. The Agent Studio composer chooses whether that runtime kind came from a
session target or a new-session selection; helper modules must not know about
session-vs-new-session branching.

### Session Actions

Files:

- `handlers/start-session.ts`
- `handlers/session-actions.ts`
- `handlers/send-agent-message.ts`
- `handlers/stop-session.ts`
- `handlers/session-model-actions.ts`
- `handlers/pending-input-actions.ts`
- `handlers/public-operations.ts`

Owns:

- start, reuse, fork, send, stop, model update, permission reply, and question reply
- persisting durable session records after starts
- rolling back failed starts
- passing route refs to listeners and context refs to runtime actions

Invariant: session-action availability answers whether an action is valid for
the selected task, role, launch action, and current loaded session. It must not
gate transcript empty-state actions on selection-resolution or runtime-loading
timing; selected-session transcript state owns that loading-vs-empty distinction.
Sessionless sends and message-first selection must use the same start-availability
policy as explicit starts. Parent Agent Studio action wiring owns that predicate;
sub-hooks receive the resulting boolean/function and must not accept selected-task
or task-readiness inputs just to re-check workflow availability.
The session-start flow may use `selectedTask` for modal context, target branch,
and human-review prompts, but it consumes parent-owned start predicates instead
of recomputing task/runtime readiness.
Kickoff visibility composes from the already-computed start decision plus the
launch action metadata; it must not re-read task workflow readiness.
Busy-send blocking and queued-follow-up support are derived by the session-action
state module from the active session plus runtime descriptor. Parent action wiring
passes that decision through; it must not rebuild the runtime capability message.

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

- creating global sessions or session observers
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
3. Persisted session records remain route candidates while runtime snapshots are checked.
4. `readRepoRuntimeSessionSnapshots` scans each runtime kind and working directory once.
5. `buildRepoSessionReadModel` commits session state once runtime snapshots are known; missing runtime evidence is `missing`.
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
| Runtime snapshot classification and idle demotion | `session-read-model/repo-session-read-model.test.ts` |
| Pending input startup snapshots without order churn or stale payloads | `session-read-model/repo-session-read-model.test.ts` |
| Running-session history baseline after reload | `lifecycle/load-sessions.test.ts` |
| Runtime prompt context for startup history loads | `use-agent-orchestrator-operations.session-state.test.tsx` |
| User messages preserved while repo/session reads are in flight | `lifecycle/load-sessions.test.ts` |
| Per-session history failure isolation | `lifecycle/load-sessions.test.ts` |
| Stale history reads are not reported as success or failure | `history/session-history-loader.test.ts` |
| Selected-session runtime/history/read-model loading surface | `transcript/session-transcript-state.test.ts`, `pages/agents/use-agent-studio-selection-controller.test.tsx`, `pages/agents/use-agent-studio-page-models.test.tsx`, and `components/features/agents/agent-chat/agent-chat-thread-state.test.ts` |
| Composer summary target cannot act as loaded session state | `features/agent-chat-composer/prompt-input/chat-composer-prompt-input-target.test.ts` and `pages/agents/chat-composer/use-agent-studio-chat-composer.test.tsx` |
| Runtime preparation failures before session start | `lifecycle/ensure-ready.test.ts` |
| Runtime snapshot projection onto session state | `lifecycle/session-runtime-snapshot.test.ts` |
| Permission/question replies through runtime refs | `handlers/session-actions.test.ts` |
| Event-driven permission/question lifecycle after startup | `events/session-permissions-questions.test.ts` |
| Readonly transcript loading and direct pending-input replies | `components/features/agents/agent-chat/readonly-transcript/use-session-transcript-surface-model.test.tsx` |
| Single selected-session route across live and persisted candidates | `pages/agents/use-agent-studio-selection-controller.test.tsx` |

## Anti-Regressions

- Do not reintroduce repo hydration coordinators, presence stores, reattach stages,
  or reconciliation stages.
- Do not make the repo session read model prepare runtime sessions. It may
  project persisted records plus runtime snapshots and hand live refs to the
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
- Do not pass generic mutable ref bundles between session hooks. Session
  observers receive the observer registry plus `SessionTransientState`; other
  refs stay with the owner that actually needs them.
- Do not add pass-through reader hooks that only wrap `agentEngine` runtime reads.
  The public operations boundary adapts `agentEngine` directly.
- Do not add parent-session pending-input overlays for subagents. Child sessions
  own pending requests; parent rows only link to child session ids.
- Do not make operations context carry read-model state. Read-model state has its
  own context.
- Do not split selected-session identity between a summary branch and a persisted
  record branch. Build one candidate list and resolve once.
