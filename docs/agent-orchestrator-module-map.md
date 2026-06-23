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

Owns:

- the current in-memory `AgentSessionState` collection for the active workspace
- derived session summaries and the activity snapshot
- notifying React subscribers when the collection changes

Invariant: `AgentSessionsStore` is the only in-memory owner for loaded
sessions. Session observation receives store operations such as `readSession`
and `updateSession`; it must not receive or inspect the mutable collection
bridge.
Hooks should expose the store, not duplicate collection getters.
Transient event state is held in explicit named refs; do not reintroduce a
generic mutable-state bridge that hides which concept owns which value.
`useAgentOrchestratorOperations` owns the session commit callback that writes to
`AgentSessionsStore` and optionally persists durable workflow records. Do not
split this into a single-use mutation hook.
Observer cleanup and runtime event handlers must read from `AgentSessionsStore`.
Session removal updates the store collection once; the session observer owner
clears matching observers and turn state for the removed identities.
Repo session read-model refreshes merge through one session store commit; the
store passes the current collection into that commit and remains the only owner
of the collection.
Session history loading, session preparation, and start/reuse policies should read
one current session through the store's selected-session reader; they must not
inspect or request full collection snapshots.
UI start flows such as Kanban receive session summaries as render snapshots;
they must not create mutable session mirrors to make callbacks look stable.

Must not own:

- persisted task session records
- runtime snapshots
- selected-session history-load policy
- live runtime routes

### Session Activity State

Files:

- `packages/frontend/src/types/agent-session-activity.ts`
- `packages/frontend/src/lib/agent-session-activity-state.ts`
- `packages/frontend/src/lib/agent-session-waiting-input.ts`

Owns:

- the shared `waiting_input`, `starting`, `running`, `idle`, `stopped`, and `error`
  UI activity vocabulary
- deriving product-facing session activity from raw status and pending input
- the precedence rule that pending questions or approvals beat raw starting/running/idle status

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

- `session-read-model/repo-session-read-model-loader.ts`
- `session-read-model/source-session-loader.ts`
- `session-read-model/repo-session-read-model.ts`
- `session-read-model/session-runtime-snapshot.ts`
- `session-read-model/use-task-session-records.ts`
- `hooks/use-repo-session-read-model.ts`

Owns:

- consuming the query-backed task session records for the active task set
- scanning runtime snapshots by repo path, runtime kind, and working directory
- merging persisted records plus runtime snapshots into `AgentSessionState`
- returning live runtime session refs

Invariant: a missing runtime snapshot means the runtime did not report the session
as live. For a cold persisted record, that means the local shell starts idle with
no runtime-owned pending input or in-flight turn state. For a mounted session,
missing runtime evidence also settles runtime-owned active state to idle and
clears pending input/in-flight turn fields. Starting, stopped, and errored raw
statuses remain local session states, but running or waiting-input state requires
runtime evidence. Transcript messages and history load state are not
runtime-owned snapshot fields and stay mounted.
Runtime events own subsequent live state only after the runtime snapshot proves
the session is live and an observer is running.
The repo read model overlays persisted session records and runtime snapshots onto
the current live session collection for the task IDs it loaded. For those loaded
task IDs, the durable task-session records are authoritative: a local session
whose identity no longer appears in the records is removed from the collection,
and the read model reports that identity so the observer owner can remove local
observer and turn state.
The per-task session-list query is the only frontend cache for persisted session
records. Do not add a separate bulk session-record cache; startup read-model
loads, Kanban history summaries, and session upserts must observe the same
per-task query keys.
Start/reuse preparation that needs a missing source session must use
`source-session-loader.ts` to load that exact persisted record and read that
exact runtime snapshot. It must not reload the repo or task read model to recover
one source session.

Must not own:

- model catalog, slash commands, file search, diffs, or other active-session reads
- runtime startup policy
- page navigation state
- history source selection or history loading
- permission/question polling

### Runtime Readiness

Files:

- `packages/frontend/src/state/queries/checks.ts`
- `packages/frontend/src/state/operations/workspace/use-checks.ts`
- `packages/frontend/src/state/operations/workspace/use-repo-runtime-health.ts`
- `packages/frontend/src/lib/repo-runtime-health.ts`
- `packages/frontend/src/lib/repo-runtime-readiness.ts`
- `packages/frontend/src/lib/use-repo-runtime-readiness.ts`
- `packages/host/src/application/runtimes/runtime-orchestrator-service.ts`

Owns:

- reading runtime health for the active repository through TanStack Query
- asking the host for `repoRuntimeHealth`
- interpreting runtime health into runtime-starting, ready, blocked, and error readiness states

`use-repo-runtime-health.ts` owns the frontend runtime-health query and refresh path. `RepoRuntimeHealthContext` is the only frontend context that exposes runtime health. `use-checks.ts` may consume that result for diagnostics toasts and manual diagnostics refresh, but `ChecksStateContext` must not expose runtime health or become a second runtime readiness surface.

Invariant: app lifecycle owns repository-runtime startup through the explicit
runtime ensure path. Runtime diagnostics must read status-only health and must
not start missing runtimes. Runtime health is live process state, so app remounts
may refresh it, but it must not poll.

Invariant: `not_started` is a passive runtime observation only. UI controlled by
the automatic repository runtime-health path must treat it as a pending startup
state, not as a terminal selected-session or diagnostics blocker.

Must not own:

- session start/send runtime preparation
- selected-session history loading
- transcript rendering state
- runtime route resolution for a concrete session action

### Session History Loading

Files:

- `history/session-history-loader.ts`
- `history/use-selected-session-history-load.ts`
- `support/session-history-chat-messages.ts`
- `support/session-prompt.ts`
- `support/subagent-messages.ts`

Owns:

- marking, applying, failing, and resetting session history load state
- resolving the selected-session history-load target from selected session,
  history state, and runtime readiness
- building transient runtime prompt context through the shared prompt helper and
  passing it to history loads without storing it in session state
- projecting runtime history into transcript messages and context usage without
  erasing live messages
- resolving subagent row identity when runtime history and live events expose
  separate part-scoped and session-scoped correlation keys

Invariant: history loading is session-scoped and policy-driven. The
selected-session baseline effect or a session action asks to load one concrete
session route; the history loader marks, applies, fails, or resets that concrete
load and returns the loaded session to awaited callers. The repo projection
never bulk-loads transcripts.
The loader receives a store-backed `readSessionSnapshot` dependency and must not
inspect or request full collection snapshots.
Selected-session history load effects are fire-and-forget UI effects, but they
must run through the orchestrator async side-effect runner with session identity
tags. Do not discard history-load promises with raw `void` calls.
They may request runtime history only when the selected session has no renderable
transcript messages; live or freshly-started sessions that already display
messages stay stream-owned until a cold reload creates an empty session shell.

`support/session-history-chat-messages.ts` owns history-message projection only.
It must not read or write durable session records.
`support/subagent-messages.ts` owns subagent row formatting, status merge, and
part/session correlation matching. Event handlers and history merge must call
that helper instead of growing their own subagent matching rules.

Invariant: transcript storage is owned by the session message helpers. UI chat
models receive a `SessionMessagesState` handle; raw message arrays may be
normalized at boundaries but must not leak into transcript rendering.

### Durable Session Records

Files:

- `support/persistence.ts`
- `support/session-cache-effects.ts`
- `support/session-invariants.ts`

Owns:

- converting workflow session state to durable task-store session records
- converting durable task-store session records back to unloaded local session
  shells
- writing durable records through the host port and the per-task session-list
  query cache for one active repository
- fail-fast workspace/session invariants shared by action and persistence
  boundaries

Must not own:

- runtime history projection
- transcript rendering
- pending permissions or questions
- system prompt display

Invariant: durable session writes require an active `workspaceRepoPath`.
Missing repository identity is a broken caller invariant, not an empty workspace
case; do not silently drop the host write or query update.

### Event Stream

Files:

- `events/session-events.ts`
- `events/session-event-router.ts`
- `events/session-event-types.ts`
- `events/session-lifecycle.ts`
- `events/session-parts.ts`
- `events/session-pending-input-routing.ts`
- `events/session-subagent-links.ts`
- `events/session-tool-parts.ts`
- `support/session-turn-metadata.ts`
- `support/session-turn-timing.ts`

Owns:

- applying runtime events to loaded sessions
- routing every stream event by its own session identity
- batching and flushing transcript stream events per session
- routing runtime todo events into the selected-session todos query owner
- pending permission and question updates after startup
- terminal status transitions such as idle, finished, and error
- active-turn model/context anchors and duration timing

Invariant: permissions and questions are fetched at startup through runtime snapshot/history reads;
after that they come from runtime events. Do not add polling.
Invariant: event handlers consume narrow runtime policies only. Runtime descriptor
lookup is owned by the observer boundary; do not pass runtime descriptors or
definition resolvers into event handlers.
Invariant: the observed event target has exactly one owner: `SessionEventContext.session`.
`store`, `turn`, and `todos` are capability groups only; they must not duplicate
session identity, key, external session id, or selected-session runtime-data fields.
Invariant: a pending permission or question belongs to exactly one `AgentSessionState`.
Parent subagent rows may link to child session ids in message metadata, but they must
not copy child pending input.
Pending-input ownership and approval reply routing live in
`events/session-pending-input-routing.ts`; subagent row link patching lives in
`events/session-subagent-links.ts`. The pending-input event handler applies the
route and mutates pending state, but must not reimplement parent/child routing.
Invariant: transcript content belongs to `session.messages` only. Do not add
parallel assistant/reasoning draft state to `AgentSessionState` or event context.
Invariant: active-turn model and context-usage message anchors live behind
`SessionTurnMetadata`. Import turn-metadata APIs from
`support/session-turn-metadata.ts`. Event handlers may record/read/clear that
owner, but must not pass raw per-session maps or refs through observer/event
boundaries.
Invariant: turn timing lives behind `SessionTurnTiming`. The orchestrator hook
owns cross-store cleanup by calling the concrete owners directly; do not
reintroduce an aggregate transient-state module or barrel.
Invariant: event batching is only a local coalescing/throttling policy for noisy
runtime stream events. It must not grow into session reconciliation, history
loading, polling, or runtime readiness logic.

### Assistant Turn Timing

Files:

- `hooks/use-orchestrator-session-state.ts`
- `support/assistant-turn-duration.ts`
- `support/session-turn-timing.ts`

Owns:

- user-message anchor timestamps for pending sends and permission/question replies
- assistant activity start timestamps from runtime status and part events
- previous assistant completion timestamps used to bound duration calculations
- duration resolution for assistant transcript metadata

Invariant: timing state lives behind the `SessionTurnTiming` store. Do not expose
the raw map, reintroduce a React timing hook, add proxy bridges, or duplicate
timestamp stores in event handlers.

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

### Existing Session Send Preparation

File:

- `handlers/prepare-session-send.ts`

Owns:

- ensuring the configured runtime process exists for an existing idle/stopped
  session before sending
- starting the event observer for the exact durable session ref when it is not
  already observed
- computing transient system prompt context for the next runtime send

It does not read runtime session snapshots, resume runtime sessions, or classify
pending input. Runtime adapters own local state preparation and event streams.
Visible pending input comes from startup snapshots or runtime events.

### Pending Input Projection

File:

- `pending-input-projection.ts`

Owns:

- routing live pending-input events to the session that should display the
  prompt
- projecting startup runtime snapshot pending input from unmaterialized child
  sessions onto the materialized parent session
- keeping runtime-owned pending permissions/questions transient

OpenCode runtime evidence includes `parentID` on child sessions; its own UI
walks the session tree when surfacing child permissions/questions. Codex
request-user-input app-server payloads are thread-scoped (`threadId`, `turnId`,
`itemId`, `questions`) and do not expose parent-session identity. Runtime
adapters may expose optional `parentExternalSessionId` on live runtime snapshots
when the runtime provides that evidence.

Do not add overlay maps or persisted pending-input records. The projection
returns only session patches/read-model effects from runtime evidence that is
available now.

### Selected Session View

Files:

- `pages/agents/agents-page-selection.ts`
- `pages/agents/use-agent-studio-selection-controller.ts`
- `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`
- `pages/agents/selected-session/selected-session-context.ts`
- `components/features/agents/agent-chat/use-agent-chat-surface-model.ts`
- `transcript/session-transcript-state.ts`

Owns:

- resolving one selected candidate for the visible task
- deriving the selected route from that candidate
- deciding whether the transcript can render, should show runtime loading, should
  show session loading, or failed to load

Invariant: live summaries and persisted records must be combined before selection.
Do not resolve live and persisted selections in separate branches.

Invariant: `selected-session-view-projection.ts` owns selected-session
projection. It walks the selected facts once and returns selected activity,
selected model, and final transcript state. It also owns the helper that derives
the selected runtime-readiness target for the hook. Runtime readiness-to-display
helpers stay in the transcript-state module. History loading policy and
runtime-data query gating live in their owner modules, not in the transcript
state model. Page route/task switching is orchestration state and must not be
stored in the transcript state model. Do not mirror runtime readiness on it.
Readonly transcript history is owned by
`readonly-transcript/use-runtime-transcript-session-history.ts`. That hook
chooses exactly one path: matching live session, runtime history read, or empty
reason, and returns final transcript state for that path. It also owns the query
enablement boundary because it has the complete facts: open state, target
identity, repo path, live session, and runtime readiness. Do not recreate a
separate source resolver or source-shaped state machine.
Readonly transcript presentation state is derived in
`readonly-transcript/runtime-transcript-surface-state.ts`; hooks must not inline
empty/loading/error policy. Displayed-session working state stays with the hook
that passes the session into the shared chat model.
Agent chat renderable-thread projection is derived once in
`agent-chat/agent-chat-thread-state.ts`. That projection owns the renderable
thread session, active session key, transcript notice copy, and reset-window
policy; surface hooks and rendering components must not reinterpret transcript
state directly or pass a separate transcript-pending boolean beside transcript
state.
Agent chat types must reference the canonical selected-session transcript state and
repo-runtime readiness contracts instead of declaring local lookalike shapes.
Selected-session history loading is owned by
`history/use-selected-session-history-load.ts` plus
`AgentSessionState.historyLoadState`. That hook starts a history load when the
selected session exists, its history has not been requested, and the runtime is
ready. Callers pass the loaded session plus runtime-readiness state; they must
not build a separate history-load target or duplicate the `historyLoadState`
policy. The selected-session view is passive: it returns selected session facts,
runtime readiness, runtime data, and transcript state, but it must not call
runtime/session operations. Transcript state is display-only: it renders runtime
waiting, session loading, visible, or failed from the current owner facts, but it
must not drive the data load. Shell, right-panel, and build-tool modules may
derive edge booleans from `viewTranscriptState`, but central selection must not
expose a second `isSessionViewLoading` field.
Selected-session model choice belongs to the selected session summary until the
full session is loaded, then to `AgentSessionState.selectedModel`. The selected
view may expose that display fallback only as `selectedSessionModel`; do not wrap
it in a session-shaped selected-view projection.
Selected-session view projection receives selected facts once: inactive,
selected task, selected session, or loaded session. Runtime readiness target,
transcript state, selected activity, and selected model all derive there. Do not
split that work into separate source-resolution and projection APIs.
Outside those boundaries, selected-session existence is the selected session
identity itself; pass `selectedSessionIdentity` and derive booleans locally only
when a branch truly needs them. Likewise, pass `selectedSessionModel` instead of
a mirrored `hasSelectedSessionModel` flag.
`use-agent-studio-selected-session-view.ts` owns the selected-session view shape.
Selection controllers may add task/tab context, but must not rename the selected
session, runtime-data, readiness, role, launch-action, or transcript fields into
a parallel view model.
Shell, route, and selection-controller modules must not accept or forward
runtime readiness, runtime health, runtime definitions, or runtime catalog
loader props for the selected session. The selected-session view owner reads the
runtime/check contexts directly when deriving `runtimeReadiness` and
`sessionRuntimeData`.
`selected-session-view-projection.ts` owns the selected-session projection:
loaded session, selected session, selected task, or inactive. The runtime-target
helper, transcript state, selected activity, and selected model must stay in
that module instead of rebuilding the same branch ladder in the hook.
`selected-session-context.ts` exposes transcript state as selected-session state,
not as runtime state. Runtime context contains runtime definitions, readiness,
and selected-session runtime data only.
Build-tool worktree refresh is not a transcript surface. It observes build
session messages and `historyLoadState` only; do not pass transcript loading
state through the shell to suppress historical tool completions.
Repo-session read-model loading is exposed through one read-model state context:
`sessionReadModelLoadState` plus the explicit owner command
`reloadSessionReadModel`. Do not split it back into independent loading and
error fields or caller-owned retry loops; selected-session view projection is
the only selected session layer that interprets read-model load state into
transcript state. Expose this surface only through
`AgentSessionReadModelStateContext`; do not put it back on aggregate agent state
or operations values.
`useAgentOrchestratorOperations` returns explicit owned buckets only:
`sessionStore`, `operations`, and `readModelState`. Do not reintroduce a
legacy aggregate hook result that spreads operation methods and session snapshots
beside those buckets.
Do not reintroduce `useAgentState` or `AgentStateContextValue`; consumers must
read sessions and operations through the dedicated hooks/contexts.
Page shell, route, and selection-controller modules must not accept or forward
`sessionReadModelLoadState`; the selected-session view owner reads it directly
from the context when deriving transcript state.
The exposed read-model load state must be current for the active repository and
the current read-model inputs; while either input is not ready, expose a loading
state instead of an empty/ready state.
`useRepoSessionReadModel` owns that public projection and the actual repo read
lifecycle: start the repo read, commit ready, or commit failed. It must not
prepare runtime sessions or choose transcript/history load policy.
It reads runtime health from the canonical checks state to derive runtime
readiness for persisted sessions. Do not pass runtime health through
`AgentStudioStateProvider` or `useAgentOrchestratorOperations`.
The repo read-model load is keyed by the selected repository plus the task id
set. Task metadata changes and task order changes must not restart the repo
session read model, because that would temporarily demote selected sessions back
to loading and cause transcript/status flicker.
For the task id set it loaded, the repo read model treats durable task-session
records as the session existence source. Missing records remove non-starting
local sessions for those tasks and report the removed refs to the observer owner.
Only local `starting` sessions may remain without a visible record while session
registration catches up.
The transcript-state module owns the generic runtime-bound transcript helpers:
runtime-bound empty, runtime-bound loading, loaded session, failed, and visible.
Selected-session and read-only transcript surfaces return final transcript state
through those helpers. Do not add parallel selected-session or read-only
transcript state machines.

Invariant: subagent waiting badges are derived from child session summaries.
Selected-session state must not maintain parent-owned pending-input projections.
Workflow context builders receive selected session identity and selected session
role as separate facts. Do not fabricate partial `AgentSessionState` objects just
to drive workflow/session-selector state. The selected role comes from the
selection resolver; loaded session state must not repair or override it.

### Agent Studio Task Tabs

Files:

- `pages/agents/agent-studio-task-tabs-storage.ts`
- `pages/agents/agent-studio-task-tabs-list.ts`
- `pages/agents/agents-page-session-tabs.ts`

Owns:

- repo-scoped task-tab persistence in localStorage
- pure task-tab list operations such as ensure, reorder, fallback, and close
- workflow/session projection for tab status, workflow rail state, session
  selector options, and session creation options

Invariant: tab persistence and tab-list operations do not own session status,
runtime readiness, selected-session identity, or workflow rail state. Keep those
concerns in `agents-page-session-tabs.ts`, and do not reintroduce localStorage or
generic tab-array helpers into the workflow/session projection module.

### Selected Session Runtime Data

Files:

- `hooks/use-session-runtime-data.ts`
- `support/session-runtime-data-refs.ts`
- `types/selected-session-runtime-data.ts`
- `state/queries/agent-session-todos.ts`
- `state/queries/runtime-catalog.ts`
- `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`

Owns:

- resolving selected-session runtime-data query refs from the session and runtime definitions
- gating selected-session runtime-data reads on repo runtime readiness without changing the refs
- reading selected-session model catalog through the runtime-catalog query owner
- reading selected-session todos through the session-todos query owner
- owning live todo state through the same todos query cache used for selected-session reads
- reporting selected-session runtime-data read errors
- providing view-only runtime data to Agent Studio

Must not own:

- `AgentSessionState` identity, status, transcript messages, or history load state
- canonical session todos; todos are runtime data, not session state
- status/activity-derived gates for selected-session runtime-data reads
- task session records
- model catalog, slash-command catalog, skills catalog, or file-search query ownership
- runtime route resolution

Invariant: runtime-data reads and runtime todo events must not rewrite the session
store. Agent Studio may compose a chat thread session from raw
`AgentSessionState` plus selected-session runtime data at the presentation
boundary, but lifecycle decisions must use the raw selected `AgentSessionState`.
Runtime events update todos through `updateSessionTodosQueryData`; do not
reintroduce a writer object or pass a second session route through event context.
Session-todos query keys, unavailable keys, stale windows, and disabled-query
fail-fast behavior live in `state/queries/agent-session-todos.ts`. Readonly
transcript history query keys live in `state/queries/agent-session-history.ts`.
Runtime catalog query keys and catalog reads live in
`state/queries/runtime-catalog.ts` for model catalogs, slash commands, skills, and
file search. The selected session runtime-data refs resolver owns read eligibility
and stable runtime/session refs. The React hook owns only query wiring and view
composition. Agent Studio passes selected-session runtime data as one object:
model catalog, todos, loading state, and read error stay together. Do not add
parallel `runtimeDataError` or `activeSessionRuntimeData` fields that split this
concept across view models. The orchestration controller must forward that object
to selected-session consumers such as the chat composer and session actions; it
must not project model catalog/loading/runtime descriptor fields into separate
hook arguments.

### Agent Studio Documents

Files:

- `pages/agents/use-agent-studio-documents.ts`

Owns:

- loading and refreshing task documents for the selected task
- applying optimistic document updates from completed workflow tool messages
- deduping processed document-tool events for the selected session

Invariant: document event tracking is keyed by selected-session identity, not by
loaded session availability. The loaded session is only the message source. If the
selected identity remains the same while loaded session state temporarily catches
up, processed document events must not reset or replay.

Must not own:

- selected-session transcript loading state
- session status, runtime readiness, or runtime data
- workflow/session-selector identity

### Agent Chat Composer

Files:

- `pages/agents/agent-studio-chat-surface-state.ts`
- `pages/agents/chat-composer/use-agent-studio-chat-composer.ts`
- `features/agent-chat-composer/context-usage/use-selected-session-context-usage.ts`
- `features/agent-chat-composer/model-selection/model-selection-preferences.ts`
- `features/agent-chat-composer/prompt-input/chat-composer-prompt-input-runtime.ts`
- `features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands.ts`
- `features/agent-chat-composer/prompt-input/use-chat-composer-skills.ts`

Owns:

- composing model-selection choices for a new message or new session
- resolving composer model selections from one explicit model-selection source:
  selected session or new session
- resolving selected composer runtime kind from selected-session model, draft
  selection, role default, and repo default
- deriving composer draft scope from task, role, and selected-session identity;
  rendered chat components may receive a string key, but hooks must not parse it
- deriving Agent Studio chat empty-state/kickoff visibility and composer
  read-only state
- keeping selected-session target identity and selected-model fallback available
  while the full selected session is still loading
- deriving context usage from the loaded session's live context usage and messages
- resolving the single prompt-input runtime state from one explicit prompt-input
  source, repo-runtime readiness, and unavailable runtime context
- passing runtime-backed composer tools a `RuntimeWorkingDirectoryRef` for both
  loaded-session and pre-session repo targets

Must not own:

- selected-session transcript loading state
- canonical session status, messages, pending input, or history load state
- runtime route resolution beyond the already-derived working-directory ref
- duplicate session-named catalog APIs for model catalogs, slash commands, skills,
  or file search

Invariant: a session summary may identify the selected session and selected model,
but it must not provide loaded-session status, messages, or context usage.
Summary-only sessions are waiting prompt-input state, not an alternate session
catalog path. Slash commands, skills, and file search must consume the shared
prompt-input runtime state and runtime-catalog query owner instead of recomputing
session/repo/loading/runtime-error booleans independently or exposing duplicate
`readSession*Catalog` APIs.
Pre-session repo tools use the repository root as their working directory, but
they still pass that through the same runtime working-directory ref shape as
loaded-session tools.

Invariant: Agent Studio chat surface state receives selected-session transcript state
and already-computed start availability. It must not recompute task workflow
availability or runtime readiness.
It receives the selected-session key directly; do not wrap task/workflow/session
facts into a local selected-session object or pass a mirrored
`hasSelectedSession` boolean.
The generic chat composer may receive an already-computed waiting-input
placeholder string, but it must not receive pending approval/question payloads or
derive pending-input copy from `AgentSessionState`.
Agent Studio passes selected-session identity and loaded session state as
separate facts into the composer model. Do not reintroduce a copied
composer-only session object, store runtime-data loading on a session-shaped
object, or pass the full loaded session into prompt-input runtime helpers.
Prompt-input helpers consume only the selected session identity plus the
repo-runtime readiness state. Session activity is transcript/UI state; it must
not be reused as a runtime readiness proxy.
The selected-session view owns selected-session identity. The composer may use a
loaded session for model, context-usage, and activity facts, but it must not
replace the selected-session identity with an identity derived from the loaded
session object. The chat surface receives the selected-session key once and
passes it to thread layout/windowing and composer autofocus; neither path should
rederive that key from a loaded session that can temporarily be unavailable while
session state catches up. Runtime kind and working directory are identity-owned
facts exposed as `selectedSessionIdentity`. Do not wrap them in a
session-shaped projection object, recover identity from a loaded session or
summary snapshot, or expose mirrored top-level selected-session fields.
Selected-session existence is `selectedSessionIdentity !== null`; do not expose a
duplicate `hasSession` projection field.
Selected-session activity is exposed separately as `selectedSessionActivityState`.
Consumers that own action or build-tool policy can derive local booleans from
that activity fact.
Selected interaction role belongs to the selected-session view, not
selected-session identity; do not mirror it as a selected-session field.
Workflow/header model builders receive selected-session identity only, not the
whole selected-session view. The selected-session context owns the selected
role; workflow context must not mirror it as a second selected-role field. The
selected-session context owns only the active document, not right-panel
availability. The right-panel hook derives panel kind, open state, and toggle
visibility from role plus task/document availability at the usage site.
Model-selection actions receive a loaded selected-session identity only when a
user explicitly changes the selected session model; otherwise they update the
new-session draft selection. Do not add automatic loaded-session model sync
effects, and do not store a mirrored loaded-session identity. The composer can
derive that action target from the loaded session it already receives.
Selected-session model fallback is exposed separately as `selectedSessionModel`
and remains display-only until the user changes the model.
An explicit session model action requires that selected session to be loaded.
Missing loaded-session state is a caller invariant error, not a no-op model
update. Session model actions persist the selected model before touching the
runtime adapter, because selected model is durable session context. Runtime model
sync is attempted only for observed sessions; unobserved idle or stopped session
shells keep the durable choice for the next send/start preparation.

Invariant: build-tools worktree reads are owned by
`features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.ts`.
Their query identity is the repo, task id, and task version. Do not pass
transcript loading, active-session identity, or task-loading flags through the
Agent Studio shell to force worktree refreshes.
Build-tool Git refreshes are owned by
`features/agent-studio-build-tools/use-agent-studio-build-worktree-refresh.ts`.
That hook may ignore history-load snapshots through `AgentSessionState.historyLoadState`,
but it must not depend on selected-session transcript presentation state.

Invariant: prompt-input capability helpers receive one already-selected runtime
kind. The Agent Studio composer chooses whether that runtime kind came from a
session target or a new-session selection; helper modules must not know about
session-vs-new-session branching.
Model-selection preference rules live in
`features/agent-chat-composer/model-selection/model-selection-preferences.ts`.
The Agent Studio composer hook wires data and queries; it must not reimplement
selected-session/new-session model fallback or runtime-kind priority rules.

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
gate transcript empty-state actions on selection timing or runtime-loading
timing; selected-session view projection owns that loading-vs-empty distinction.
Selected-session send policy must resolve runtime capabilities from selected-session
runtime data or `AgentSessionState.runtimeKind`; it must not use composer model
selection as a substitute runtime source for an already-selected session.
Session actions receive `selectedSessionModel` for the catalog-loading send
guard. Do not pass a mirrored `hasSelectedSessionModel` flag, and keep
model-selection details with the composer/model-selection owner.
Send, question, and approval action sub-hooks receive selected-session identity
for their runtime target. They must not rederive that identity from the loaded
session object, because the loaded session can temporarily be unavailable while
the selected target stays valid.
Session-action derived state owns busy, waiting-input, queued-message, and busy
send-blocking policy only. Selected-session existence is the selected-session
identity itself; do not add a mirrored `hasSelectedSession` field to action state.
Selected Session Runtime Data owns model-catalog loading; do not mirror that
loading state through action state.
Pending-question and pending-approval payloads still come from the loaded
session. The selected-session store owns those payloads; action hooks only track
local submit state and call the runtime reply operation.
Once an action reaches the session operation boundary with a concrete session
identity, that session must be loaded for mutating operations such as send,
model update, and pending-input reply. Missing loaded session state is an
invariant error, not a silent no-op.
Fresh and fork starts that need an immediate post-start message are held in
`starting` by the start-session flow before creation; releasing that held state
belongs to the send-message path and must not be exposed through page-level code.
After the start modal returns a concrete decision, every Agent Studio session
start is tracked as starting by the start-session flow. Do not add per-call
tracking flags or start paths that bypass starting activity publication.
Post-start messages are part of the session-start workflow and are awaited by the
single `RunSessionStartWorkflow` command. Do not add detached/fire-and-forget
kickoff sends; a session start must not complete before the kickoff send has
finished or failed. Post-start send failures are returned on
`SessionStartWorkflowResult.postStartActionError`; entry surfaces may report that
result, but the shared workflow runner must not accept UI/reporting callbacks for
the same error.
Sessionless sends and message-first selection must use the same start-availability
policy as explicit starts. Parent Agent Studio action wiring owns that predicate;
sub-hooks receive the resulting boolean/function and must not accept selected-task
or task-readiness inputs just to re-check workflow availability.
The session-start flow may use `selectedTask` for modal context, target branch,
and human-review prompts, but it consumes parent-owned start predicates instead
of recomputing task/runtime readiness.
The session start modal reads available runtime definitions from runtime
availability context. Do not pass a second runtime-definition list into the
modal state; start-mode filtering is local modal selection policy, and runtime
health/readiness interpretation stays in `useRepoRuntimeReadiness`.
Agent Studio, Kanban, and Autopilot start entry points consume a single
`RunSessionStartWorkflow` command. Only shell/provider composition wires that
command from `startAgentSession` and `sendAgentMessage`; page/business modules
must not receive both low-level operations and reassemble post-start behavior.
Kickoff visibility composes from the already-computed start decision plus the
launch action metadata; it must not re-read task workflow readiness.
Busy-send blocking and queued-follow-up support are derived by the session-action
state module from the active session plus runtime descriptor. Parent action wiring
passes that decision through; it must not rebuild the runtime capability message.
Session-action state derivation is pure: runtime definitions are passed from the
orchestration boundary, not read from React context inside lower action helpers.

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
- `state/operations/agent-orchestrator/session-read-model/use-task-session-records.ts`
- `state/operations/agent-orchestrator/session-read-model/repo-session-read-model.ts`

Owns:

- reading durable task session records through per-task session-list queries
- keeping per-task session-list query keys as the only frontend cache for persisted session records
- projecting current local sessions against loaded durable records during repo reads
- presenting task session history to Agent Studio, Kanban, task details, and autopilot

Must not own:

- live runtime status
- transcript messages
- runtime route resolution

Invariant: UI decisions must not read session history from `TaskCard.agentSessions`.
Use task session record queries instead, so task cards remain task summaries and
session history has one frontend read boundary.
Repo startup session loading is keyed by task IDs only. Task title, status,
document, or workflow metadata changes must not reload the repo session read
model. Task-session query invalidation/refresh owns persisted session-record
changes for UI history surfaces. Orchestrator internals must not reload the repo
session read model for explicit start/reuse preparation; they may load exactly
one source session through `source-session-loader.ts`.
`useTaskSessionRecords` is the only hook that fans out per-task session-record
queries for repo startup. `useRepoSessionReadModel` consumes that result, asks
repo runtime readiness which persisted runtime kinds are snapshot-readable, and
owns repo session projection/commit. It must not interpret runtime health
directly. Task reset pages must not call a session refresh command after reset. Reset
operations invalidate the exact task-session-record query, and the repo read
model reacts to that owned query data.
Local session projection during repo reads is owned by
`repo-session-read-model.ts`. It carries sessions outside the loaded task set and
local starting sessions whose persisted record is not visible yet; every other
local session for the loaded task set must have a durable record or become an
unlisted session ref whose observer state can be cleared.

## Startup Flow

1. The app loads task IDs from the task store.
2. `use-task-session-records.ts` reads per-task session records through the
   shared task-session query keys.
3. Persisted session records remain route candidates while runtime snapshots are checked.
4. `readRepoRuntimeSessionSnapshots` scans each snapshot-readable runtime kind and working directory once.
5. `buildRepoSessionReadModel` commits every persisted session record once runtime snapshots are known; missing runtime evidence starts cold persisted records idle and settles mounted runtime-owned active state without clearing mounted transcript history.
6. Live sessions are observed by route ref. The session observer asks the runtime
   adapter to subscribe; the adapter requires an already-live repo runtime route
   and may prepare only session-local adapter state before events can flow.
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
| Missing runtime evidence settles runtime-owned active state and starts cold persisted sessions idle | `session-read-model/session-runtime-snapshot.test.ts`, `session-read-model/repo-session-read-model.test.ts`, and `session-read-model/repo-session-read-model-loader.test.ts` |
| Task metadata changes cannot churn the repo session read model | `hooks/use-repo-session-read-model.test.tsx` |
| Pending input startup snapshots without order churn or stale payloads | `session-read-model/repo-session-read-model.test.ts` |
| Child pending input survives reload on a materialized parent | `pending-input-projection.test.ts` and `session-read-model/repo-session-read-model.test.ts` |
| Running-session history baseline after reload | `history/use-selected-session-history-load.test.tsx`, `pages/agents/use-agent-studio-selection-controller.test.tsx`, and `session-read-model/repo-session-read-model-loader.test.ts` |
| Runtime prompt context for startup history loads | `use-agent-orchestrator-operations.session-state.test.tsx` |
| User messages preserved while repo/session reads are in flight | `session-read-model/repo-session-read-model-loader.test.ts` |
| Transient repo read-model startup failure can recover without polling | `hooks/use-repo-session-read-model.test.tsx` |
| Per-session history failure isolation | `session-read-model/repo-session-read-model-loader.test.ts` |
| Stale history reads are not reported as success or failure | `history/session-history-loader.test.ts` |
| Selected-session runtime/history/read-model loading surface | `pages/agents/selected-session/selected-session-view-projection.test.ts`, `pages/agents/use-agent-studio-selection-controller.test.tsx`, `pages/agents/use-agent-studio-page-models.test.tsx`, and `components/features/agents/agent-chat/agent-chat-thread-state.test.ts` |
| Selected-session runtime-data ref eligibility | `support/session-runtime-data-refs.test.ts` and `hooks/use-session-runtime-data.test.tsx` |
| Composer summary runtime cannot act as loaded session state | `features/agent-chat-composer/prompt-input/chat-composer-prompt-input-runtime.test.ts` and `pages/agents/chat-composer/use-agent-studio-chat-composer.test.tsx` |
| Existing idle session send preparation | `handlers/prepare-session-send.test.ts` and `handlers/session-actions-send.test.ts` |
| Runtime snapshot projection onto session state | `session-read-model/session-runtime-snapshot.test.ts` |
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
- Do not treat a missing runtime snapshot as an idle runtime event. A cold
  persisted session starts idle from its durable record. A mounted session loses
  runtime-owned active state while transcript/history stays mounted; running and
  waiting-input state require runtime evidence from snapshots or events.
- Keep runtime ids and runtime routes in low-level adapters/registry code. UI and
  page modules should carry runtime kind plus working directory, not live routes.
- Keep frontend runtime dispatch direct: `agent-runtime-services.ts` owns adapter
  selection from the required `runtimeKind` and exposes only the agent engine plus
  runtime catalog operations. Do not reintroduce optional-runtime dispatch helpers
  or missing-runtime repair there.
- Do not store live runtime routes, pending permissions, pending questions, or
  transcript stream state in task records.
- Do not pass generic mutable ref bundles between session hooks. Session
  observers receive the observer registry plus the concrete turn-state owners
  they use; other refs stay with the owner that actually needs them.
- Do not add pass-through reader hooks that only wrap `agentEngine` runtime reads.
  The public operations boundary adapts `agentEngine` directly.
- Do not add parent-session pending-input overlays for subagents. Child sessions
  own pending requests; parent rows only link to child session ids.
- Do not make operations context carry read-model state or task-session refresh.
  Read-model load state lives in the read-model context; exact source-session
  recovery lives in `source-session-loader.ts`.
- Do not split selected-session identity between a summary branch and a persisted
  record branch. Build one candidate list and resolve once.
