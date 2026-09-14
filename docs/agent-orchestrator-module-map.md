# Agent orchestrator module map

Use this map before you change `packages/frontend/src/state/operations/agent-orchestrator` or a Task Workflows session flow.

The host owns live session truth for task and workspace sessions. SQLite owns their durable records. The renderer holds one projection of those sources. History loads only for the selected session.

Pass primitive identity through these modules. Use `workspaceRepoPath` for repository session state. Pass `workspaceId` only to code that reads repository config or starts a runtime. Do not pass `ActiveWorkspace` into transcript, action, or read-model modules.

## Session store

Files: `packages/frontend/src/state/agent-sessions-store.ts` and `hooks/use-orchestrator-session-state.ts`.

Owns the current `AgentSessionState` collection, derived summaries, activity snapshot, and React notifications.

Rules:

- The store is the renderer projection of the latest host snapshot and ordered changes. It is not the source of runtime activity, pending input, context, or routes.
- `useAgentOrchestratorOperations` owns the commit that writes the store and, when needed, durable records.
- A repository refresh commits through this store once. Do not add a second session collection.
- Read one selected session through the store reader. Do not request a full collection only to prepare or load one session.
- Pass summaries to render code as snapshots. Do not build a mutable mirror.

## Activity state

Files: `types/agent-session-activity.ts`, `lib/agent-session-activity-state.ts`, and `lib/agent-session-waiting-input.ts`.

Owns `waiting_input`, `starting`, `running`, `idle`, `stopped`, and `error`.

Pending questions or approvals take priority over raw starting, running, or idle status. Tabs, Kanban, sidebars, actions, and transcripts use this shared rule. Summaries contain `activityState` and pending counts. Full pending payloads remain on `AgentSessionState`.

## Host live projection

Files: `session-read-model/agent-session-live-projection.ts`, `session-read-model/agent-session-workflow-records.ts`, `session-read-model/source-session-loader.ts`, `session-read-model/use-task-session-records.ts`, and `hooks/use-repo-session-read-model.ts`.

Owns durable record reads, root admission from durable records or explicit starts, host live attachment, the first snapshot, ordered changes, one collection commit, and parent-child pending-input links.

Rules:

- Attach the host listener before `agentSessionLiveRefresh`.
- A live snapshot cannot create a root. A root enters through an OpenDucktor start registration or a durable task or workspace session record.
- A live event can add a descendant only when its parent already exists in the collection.
- On reload, the host reads exact root references from durable task and workspace session records. Runtime adapters read only those roots and their verified descendants.
- Runtime state cannot prove task ownership. Only an explicit workflow start or durable task record can attach a session to a task.
- The browser uses one tagged SSE channel for all host events. Electron uses its generic host-event IPC message.
- Ignore replayed changes while a reconnect waits for its new snapshot.
- Treat each later snapshot as a full collection reset.
- Commit a snapshot once so rows, activity, pending input, context, and counters use the same state.
- Per-task session-list queries own workflow records. Workspace session-list queries own repository records. The first live projection waits for task records and for the workspace record query to settle. A workspace record failure blocks chat actions, not healthy task sessions.
- Load one missing source record through `source-session-loader.ts`. Do not load its transcript or refresh the full repository model.

This owner does not load catalogs, file status, diff, selected history, or page navigation. It does not select a native runtime protocol.

`commitTranscriptActivity` applies transcript activity through the same collection commit before transcript assembly. It retains required pending-input links, including terminal child updates. It does not collect approval policy actions or reconcile workspace targets. Snapshots, session upserts or removals, and durable ownership updates retain those checks. Unchanged text deltas still reach transcript assembly.

## Host command ownership

Files: `packages/host/src/application/agent-sessions/agent-session-command-service.ts`, `agent-session-operation-policy.ts`, `task-workflow-session-policy.ts`, and `packages/host/src/application/workspaces/workspace-session-runtime-persistence.ts`.

One command module owns session control. Task and workspace policy adapters supply stored identity, prompts, validation, and persistence. They do not form separate live orchestrators.

- Hold the owner permit across fresh validation, native control, durable save, and recovery. Workflow commands use the existing task lifecycle guard. Workspace commands and archive share one per-session gate.
- Native event observation must not acquire a command permit. Native controls can wait for their live events to commit.
- Separate durable model save from event publication. The task-event module owns task publication rules. Composition only connects dependencies.
- Report a failure after message acceptance without sending the message again.
- Keep task start and workspace start as explicit durable operations. Generic native start or fork does not prove durable ownership.

`AgentSessionMessageAcceptedError` retains a validated native message, its exact session reference, and the failed host stage. All runtime control adapters preserve acceptance across later live updates. The shared live module also preserves acceptance when the runtime detaches before the send returns. The shared command uses the same error for a failed metadata save. The router sends its `agent_session_message_accepted` failure through the existing host error contract. A rejection or invalid native response does not prove acceptance.

`WorkspaceSessionStorePort.recordAcceptedMessage` validates and saves the generated title, monotonic activity time, and optional accepted model in one existing SQLite transaction. The workspace persistence policy publishes the returned record after commit. A publication failure cannot undo the save. Model-settings changes retain the stored `profileId`, including after compensation.

## Host runtime lifecycle

Files: `packages/host/src/application/agent-sessions/agent-session-live-state-service.ts`, `agent-session-live-runtime-lifecycle.ts`, and `packages/host/src/ports/agent-session-live-adapter-port.ts`.

The live module owns runtime registration and ordered publication. Its internal lifecycle module owns registration leases, detach, and cleanup.

- Create one nominal registration lease for each adapter. Its bound mutation method retains the lease when copied. Prepared or detached leases cannot publish live changes.
- Detach and publish known removals under the live coordinator. Release native resources outside that coordinator.
- After a failed detach read, publish an authoritative snapshot of the remaining registrations. Keep the original read error and report any cleanup or publication errors.
- A host execution episode identifies a run. Renderer terminal state applies only to that episode. Current pending input takes priority.

## Workspace metadata and notifications

Files: `state/queries/workspace-sessions.ts`, `state/queries/workspace-session-updates.ts`, `state/queries/agent-session-association.ts`, and `features/notifications/notification-workspace-observer.ts`.

One metadata subscription updates each shared query cache. Keep events that arrive during a record read until its cache commit. Discard a cancelled read's buffer once. Do not cancel a cold baseline or publish an incomplete baseline to apply an event.

Notifications use task and workspace record caches to prove ownership, including in inactive workspaces. Their occurrence deduplication does not own live session state. A later record update can resolve a pending occurrence without a new native event. Workspace navigation requires an exact stored runtime kind, external session ID, and working directory.

## Runtime readiness

Files: `state/queries/checks.ts`, `operations/workspace/use-checks.ts`, `operations/workspace/use-repo-runtime-health.ts`, `lib/repo-runtime-health.ts`, `lib/repo-runtime-readiness.ts`, `lib/use-repo-runtime-readiness.ts`, and `packages/host/src/application/runtimes/runtime-orchestrator-service.ts`.

Owns the runtime health query and the mapping to starting, ready, blocked, or error.

`RepoRuntimeHealthContext` is the only frontend runtime health context. Diagnostics can read it but cannot expose a second copy. App lifecycle starts a repository runtime. A diagnostic reads health only. It does not start or poll a runtime.

`not_started` is a passive observation. During automatic startup, treat it as pending startup, not a terminal session error.

## Selected history

Files: `history/session-history-loader.ts`, `history/use-selected-session-history-load.ts`, `support/session-history-chat-messages.ts`, `support/session-prompt.ts`, and `support/subagent-messages.ts`.

Owns one selected session history request, its load state, transient prompt context, message projection, merge with live messages, and subagent correlation.

Rules:

- Mark, apply, fail, or reset one concrete session load.
- The caller that claims the load makes the request. Another caller reads the current session snapshot.
- Start the selected history load through the tagged async side-effect runner.
- Load history when state is `not_requested`, even if a live tail is visible.
- Merge history with current messages. Do not erase live items.
- A history read does not resume, discover pending input, change activity, set context, or drain events.
- `support/subagent-messages.ts` owns subagent formatting and correlation.
- Transcript data lives in `SessionMessagesState`.

## Selected context

Files: `history/use-selected-session-context-load.ts` and `features/agent-chat-composer/context-usage/use-selected-session-context-usage.ts`.

Load context only when the selected live session has no context usage and the runtime is ready. Keep current context usage on the snapshot path. A failure uses the operation error path. It does not start history, polling, or all-session recovery.

## Durable records

Files: `support/persistence.ts`, `support/session-cache-effects.ts`, and `support/session-invariants.ts`.

Owns conversion between workflow sessions and durable task-store records, writes to the host and per-task query cache, and shared identity checks.

A durable write requires `workspaceRepoPath`. Missing repository identity is an invariant error. Do not skip the write. Durable records do not own transcripts, pending input, history projection, or system prompt display.

## Transcript events

Files: `events/session-transcript-events.ts`, `events/session-event-types.ts`, `events/session-lifecycle.ts`, `events/session-parts.ts`, `events/session-tool-parts.ts`, `support/session-turn-metadata.ts`, and `support/session-turn-timing.ts`.

Owns transcript event routing, per-session batching, todo event forwarding, active-turn anchors, and duration.

`support/image-generation-messages.ts` owns image message projection. `support/image-generation-settlement.ts` applies image lifecycle outcomes.

Rules:

- Live activity, pending input, context, and removal arrive as live-state messages. Only `agent-session-live-projection.ts` applies them. It also applies activity carried by a transcript event before transcript buffering. Transcript assembly cannot change activity.
- `SessionTranscriptEventContext.session` is the only event target. Other capability groups do not copy session identity.
- Transcript text exists only in `session.messages`.
- `SessionTurnMetadata` owns turn anchors. `SessionTurnTiming` owns timing.
- Batching can reduce noisy stream updates. It cannot reconcile sessions, load history, poll, or decide runtime readiness.

## Assistant timing

Files: `hooks/use-orchestrator-session-state.ts`, `support/assistant-turn-duration.ts`, and `support/session-turn-timing.ts`.

`SessionTurnTiming` owns user-message anchors, assistant start times, previous completion times, and final duration. Do not expose its raw map or create a second timing store.

## Runtime references

File: `support/session-runtime-ref.ts`.

Use a route reference for host control and history. It contains `externalSessionId`, `repoPath`, `runtimeKind`, and `workingDirectory`.

Use a context reference for send and reply. It adds task ID, role, optional model, and optional purpose. Do not add prompts, runtime IDs, or native request IDs to generic live observation.

## Prepare an existing session

File: `handlers/prepare-session-send.ts`.

Before a send to an idle or stopped session, make sure its configured runtime process exists and build transient system prompt context. This step does not attach observation, read a snapshot, resume a session, or classify pending input.

## Pending input

Files: `session-read-model/agent-session-live-projection.ts`, `session-read-model/pending-approval-policy.ts`, and `handlers/pending-input-actions.ts`.

Owns pending-input projection, child-to-parent attention links, read-only approval policy, and opaque reply handles.

Keep native IDs in the host adapter. Keep pending payloads in live state. Do not persist them or add frontend overlay maps.

## Selected session view

Files: `pages/agents/agents-page-selection.ts`, `pages/agents/use-agent-studio-selection-controller.ts`, `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`, `pages/agents/selected-session/selected-session-context.ts`, `components/features/agents/agent-chat/use-agent-chat-surface-model.ts`, and `transcript/session-transcript-state.ts`.

Owns the selected candidate, its identity, runtime readiness target, selected activity, selected model, and final transcript state.

Rules:

- Combine live summaries and durable records before selection. Resolve one candidate.
- `selected-session-view-projection.ts` walks the facts once. Do not repeat its branch logic in hooks.
- The view is passive. History and runtime-data owners make requests.
- A transcript stays in loading until history is `loaded`. If a visible transcript later fails to reload, keep the visible transcript with the error state.
- `transcript/session-transcript-state.ts` owns runtime waiting, session loading, visible, and failed states.
- Use `selectedSessionIdentity !== null` for existence. Do not add `hasSession`.
- Keep `selectedSessionActivityState`, selected role, and `selectedSessionModel` as separate facts.
- Runtime kind and working directory belong to `selectedSessionIdentity`.
- `selected-session-context.ts` owns the active document, not right-panel state.
- Read-only transcript history chooses a live session, runtime history, or an empty reason.
- `agent-chat/agent-chat-thread-state.ts` owns the renderable session, active key, notice, and reset window.

The selected view reads runtime, check, and read-model contexts. Do not pass those values through page shells. `AgentSessionReadModelStateContext` exposes one `sessionReadModelLoadState` and `reloadSessionReadModel`.

The repository read model key is repository plus task ID set. Task title, status, order, or document changes do not restart it. Durable records prove durable existence. The host snapshot proves live existence. Only a local `starting` session can exist for a short time without either source.

## Task tabs

Files: `pages/agents/agent-studio-task-tabs-storage.ts`, `pages/agents/agent-studio-task-tabs-list.ts`, and `pages/agents/agents-page-session-tabs.ts`.

Storage owns repository-scoped localStorage. List helpers own ensure, reorder, fallback, and close. `agents-page-session-tabs.ts` owns workflow and session display. Storage and list helpers do not own runtime or session state.

## Selected runtime data

Files: `hooks/use-session-runtime-data.ts`, `support/session-runtime-data-refs.ts`, `types/selected-session-runtime-data.ts`, `state/queries/agent-session-todos.ts`, `state/queries/runtime-catalog.ts`, and `pages/agents/selected-session/use-agent-studio-selected-session-view.ts`.

Owns refs and Query reads for the selected model catalog and todos. It gates reads on runtime readiness and returns one view object with data, loading, and error.

Rules:

- Runtime data and todo events update their Query caches, not the session store.
- Query modules own keys, stale times, and disabled-query errors.
- The ref resolver owns read eligibility and stable runtime/session refs.
- The hook wires queries and builds the view.
- Lifecycle decisions use raw `AgentSessionState`, not a session object with runtime data attached.
- This owner does not resolve routes or own session identity, transcript, activity, or history state.

## Task documents

File: `pages/agents/use-agent-studio-documents.ts`.

Owns selected task document reads, refresh, optimistic workflow-tool updates, and processed event IDs.

Key event tracking by selected session identity. A short gap in loaded session state must not reset or replay processed events.

## Composer

Files: `pages/agents/agent-studio-chat-surface-state.ts`, `pages/agents/chat-composer/use-agent-studio-chat-composer.ts`, `components/features/agents/model-picker/*`, `features/agent-chat-composer/context-usage/*`, `features/agent-chat-composer/model-selection/*`, `features/agent-chat-composer/prompt-input/*`, `state/queries/use-runtime-model-catalogs.ts`, and `state/mutations/use-agent-model-favorites.ts`.

Owns model choices, favorites, search, draft scope, empty and kickoff state, context display, prompt-input runtime state, and runtime catalog queries.

Rules:

- A model choice is the exact `runtimeKind`, `providerId`, and `modelId` tuple.
- Choose either the selected session or the new-session draft.
- A canceled send restores the submitted draft through its original persistence adapter. Check the version after the submitted draft was cleared and reject restoration after newer edits. Restore an inactive draft without changing the active composer.
- A summary can provide identity and selected model. Only loaded session state can provide status, messages, pending input, or context.
- Use one prompt-input runtime state for commands, skills, and file search.
- Pass `RuntimeWorkingDirectoryRef` for both session and repository targets.
- Repository tools use the repository root. A fresh workflow session uses the canonical task worktree.
- Pass selected identity and loaded session as separate facts. Do not make a composer session copy.
- Use the selected key for thread layout and autofocus. Do not derive it again from loaded state.
- Validate runtime, provider, and model against the target catalog before a model update.
- Apply live model restrictions only when a native session identity exists. `model-selection-policy.ts` supplies the same profile and variant rules to visible options and selection actions. A saved workspace draft still uses startup model options.
- The shared host command updates the native model, saves the durable choice, then publishes metadata. If the save fails, restore the previous native model before releasing the owner permit. A publication failure after a successful save must not roll back the native model.
- `model-selection-preferences.ts` owns runtime and model fallback order.

Build-tool worktree reads belong to `features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.ts`. Their key is repository, task ID, and task version. Git refresh belongs to `use-agent-studio-build-worktree-refresh.ts`. Transcript display state does not control either read.

## Session actions

Files: `handlers/start-session.ts`, `handlers/session-launch-executor.ts`, `handlers/start-session-workflow-launch.ts`, `handlers/session-actions.ts`, `handlers/send-agent-message.ts`, `handlers/stop-session.ts`, `handlers/session-model-actions.ts`, `handlers/pending-input-actions.ts`, and `handlers/public-operations.ts`.

Owns start, reuse, fork, send, stop, model update, pending-input replies, and workflow session registration.

The shared send handler checks a typed accepted-message failure before ordinary send recovery. It upserts the native message once and adds a scoped failure notice. It completes the send action without restoring the accepted draft or resetting running state and pending input. Both task and workspace actions use this handler. Runtime-service conversion checks the exact session reference and preserves accepted model fields.

Before sending to a stopped repository or workflow session, the shared send handler resumes the same native session. It rejects an unbound session because that session has no repository or workflow scope. It checks repository continuity and retains newer live activity and pending input. For a workflow session, the host verifies that the task owns the session before it resumes it. A failed resume sends no message.

Rules:

- Action availability uses task, role, launch action, and loaded session. Transcript loading belongs to the selected view.
- An existing session gets runtime capability from its runtime data or `AgentSessionState.runtimeKind`, not the composer draft.
- A send, model update, or reply requires loaded session state. Missing state is an invariant error.
- Start code marks every decided start as `starting`.
- Register a workflow session in this order: create it in the runtime, persist its task record in the host, then attach it to local task state.
- Stop preparation failures before host control succeeds. If later frontend work fails, keep the task session stored by the host.
- Only the explicit workflow start path can register task ownership. Runtime events cannot attach an unrelated root session.
- A fresh or forked start holds `starting` until its first message finishes or fails.
- `RunSessionStartWorkflow` awaits the first message. It reports a send failure in `postStartActionError`. Kanban and the Task Workflows page supply its local recovery callback. The runner invokes that callback before notification delivery, which suppresses the generic in-app toast for that failure and keeps OS and sound policy unchanged.
- The Task Workflows page, Kanban, and Autopilot call the same `RunSessionStartWorkflow` command.
- Sessionless send uses the same start-availability rule as an explicit start.
- The start modal reads runtime definitions from runtime availability context.
- Action state owns busy, waiting, queued, and send-block rules. It does not copy identity or runtime-data loading.

## Read-only transcripts

Files: `components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.ts`, `use-runtime-transcript-interactions.ts`, and `use-session-transcript-surface-model.ts`.

Owns read-only history, preference for an existing live session, live pending input, and replies through a runtime context reference. It does not create global sessions, attach observers, resolve routes, or own workflow status.

## Task session records

Files: `state/queries/agent-sessions.ts`, `session-read-model/task-session-records.ts`, `session-read-model/use-task-session-records.ts`, `hooks/use-repo-session-read-model.ts`, and `session-read-model/agent-session-workflow-records.ts`.

Owns per-task durable record queries and task session history for the Task Workflows page, Kanban, task details, and Autopilot.

Rules:

- Do not read session history from `TaskCard.agentSessions`.
- Repository startup keys record reads by task ID only.
- Reset invalidates the exact task record query. It does not call a session refresh command.
- `useTaskSessionRecords` is the only fan-out hook. `useRepoSessionReadModel` attaches the live stream and commits the collection.
- Apply durable records before and after each live projection, then commit once. The first pass admits durable roots. The second pass restores durable workflow fields after live status is applied.
- Reject an unknown live root. Accept an unknown descendant only when its declared parent is already registered.
- Skip a record update when its read is unloaded, failed, or stale because it cannot prove deletion.
- Keep `liveReported` on session state. Do not add a presence store.

## Startup sequence

1. Read task IDs from the task store.
2. Read task and workspace session records through their shared Query keys.
3. Attach to the generic host-event channel, then request a repository live snapshot. The host reads exact root references from both durable record kinds.
4. Each runtime adapter reads only registered roots and verified descendants. Apply durable records before and after the live projection, then commit once.
5. Derive rows, activity, pending input, current context usage, and counters from that commit.
6. Apply ordered changes on the same channel. After browser reconnect, wait for a fresh snapshot before replayed changes.
7. Load history or missing context only for the selected session.

Startup is complete when task records and the first host snapshot have produced one committed collection after the workspace record query settles. Workspace record failures remain visible through `workspaceSessionRecordsError`. They do not stop the shared observer or fail task-session startup. History does not block startup.

## Regression tests

| Rule | Main tests |
|---|---|
| Reload keeps active and waiting sessions | `session-read-model/agent-session-live-projection.test.ts`, host adapter tests |
| Snapshot comes before changes | `hooks/use-repo-session-read-model.test.tsx`, `agent-session-live-state-service.test.ts` |
| Lost live evidence clears only live state | `session-read-model/agent-session-live-projection.test.ts` |
| Task metadata does not restart the model | `hooks/use-repo-session-read-model.test.tsx` |
| Pending input survives startup and child projection | Live projection and runtime adapter tests |
| History stays selected-session only | `history/use-selected-session-history-load.test.tsx`, `history/session-history-loader.test.ts` |
| Context loads apart from history | `history/use-selected-session-context-load.test.tsx`, adapter context tests |
| Browser reconnect uses one SSE channel | `local-host-transport.test.ts` |
| Selected transcript display state | `transcript/session-transcript-state.test.ts`, `agent-chat-thread-state.test.ts`, selected view tests |
| Existing idle send prepares runtime | `handlers/prepare-session-send.test.ts`, `handlers/session-actions-send.test.ts` |
| Replies use normalized refs | `handlers/session-actions-pending-input.test.ts` |
| Read-only history and replies | Read-only transcript hook tests |

## Guardrails

- Keep repository projection limited to durable records and the ordered host snapshot. It does not prepare sessions or select history.
- Use one selected history path and one transient prompt-context boundary.
- Use stored `runtimeKind` and `workingDirectory`. Missing route data is an error, not a reason to use the default runtime.
- A missing live snapshot is not an idle event. Keep history mounted, but clear runtime-owned active state.
- Keep runtime IDs and routes in adapters and the registry.
- `packages/frontend/src/state/agent-runtime-services.ts` selects an adapter from required `runtimeKind`. It does not repair a missing runtime.
- Keep live routes, pending input, and transcript streams out of task records.
- Give each hook only the concrete state owner it needs. Do not pass a general mutable ref set.
- Public operations call `agentEngine` reads directly. Do not add pass-through hooks.
- Child sessions own pending requests. Parent rows only link to child IDs.
- Operations context does not own read-model state or task-session refresh.
- Build one selected candidate list. Do not split live and durable selection paths.
