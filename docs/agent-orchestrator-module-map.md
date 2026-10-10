# Agent orchestrator module map

Use this map before you change `packages/frontend/src/state/operations/agent-orchestrator`, a task session flow, or session navigation.

The host owns live session truth for task and workspace sessions. SQLite owns their durable records. The renderer holds one projection of those sources. History loads only for an open transcript that needs a baseline or missed live events.

Pass primitive identity through these modules. Use `workspaceRepoPath` for repository session state. Pass `workspaceId` only to code that reads repository config. Do not pass `ActiveWorkspace` into transcript, action, or read-model modules.

## Session store

Files: `packages/frontend/src/state/agent-sessions-store.ts` and `hooks/use-orchestrator-session-state.ts`.

Owns the per-repository `AgentSessionState` collections, derived summaries, activity snapshot, and React notifications. The store keeps every visited repository collection in memory.

Rules:

- The store is the renderer projection of the latest host snapshot and ordered changes. It is not the source of runtime activity, pending input, context, or routes.
- `useAgentOrchestratorOperations` owns the commit that writes the store and, when needed, durable records.
- A repository refresh commits through this store once. Do not add a second session collection.
- The store keeps the `policyNotice` and `launchFailure` of each live snapshot. It puts them back into the session messages after each commit. It inserts a launch failure in timestamp order.
- Read one selected session through the store reader. Do not request a full collection only to prepare or load one session.
- Pass summaries to render code as snapshots. Do not build a mutable mirror.
- All reads and writes target the active repository. A session outside the active collection resolves to no session.
- A repository switch keeps retained transcripts and marks their history stale. The store serves the retained transcript immediately. An open transcript view refreshes it in the background.
- An unfinished baseline read returns to `not_requested` when its repository becomes inactive. An interrupted refresh returns to `stale` and keeps its visible baseline.

## Activity state

Files: `types/agent-session-activity.ts`, `lib/agent-session-activity-state.ts`, and `lib/agent-session-waiting-input.ts`.

Owns `waiting_input`, `starting`, `running`, `idle`, `stopped`, and `error`.

Pending questions or approvals take priority over raw starting, running, or idle status. Session navigation, Kanban, actions, and transcripts use this shared rule. Summaries contain `activityState` and pending counts. Full pending payloads remain on `AgentSessionState`.

The same activity snapshot exposes `pendingInputSessions` for every session with pending input, including workspace sessions and children. This count projection uses full session identity and keeps unchanged entries across transcript updates. Navigation summaries still include only their owned roots.

## Host live projection

Files: `session-read-model/agent-session-live-projection.ts`, `session-read-model/agent-session-workflow-records.ts`, `session-read-model/use-task-session-records.ts`, and `hooks/use-repo-session-read-model.ts`.

Owns durable record reads, root admission from durable records or explicit starts, host live attachment, the first snapshot, ordered changes, one collection commit, and parent-child pending-input links.

Rules:

- Attach the host listener before `agentSessionLiveAttach`. The host returns the repository snapshot to that caller only.
- The first attachment of a repository reads its durable roots and runtime sessions once. Later attachments from any browser use the live projection.
- A live snapshot cannot create a root. A root enters through an OpenDucktor start registration or a durable task or workspace session record.
- A live event can add a descendant only when its parent already exists in the collection.
- On reload, the host reads exact root references from durable task and workspace session records. Runtime adapters read only those roots and their verified descendants.
- Runtime state cannot prove task ownership. Only an explicit workflow start or durable task record can attach a session to a task.
- The browser uses one tagged SSE channel for all host events. Electron uses its generic host-event IPC message.
- Each snapshot carries the host `sequence` of the last state change that it covers. Drop older `snapshot`, `session_upsert`, and `session_removed` envelopes. Deliver an older `task_session_records_updated` without its `liveSession`. Deliver transcript and other changes in stream order.
- A reconnect with complete replay keeps the collection and the loaded transcripts. A replay gap for the repository or a new host starts a new attachment.
- A later connection snapshot can follow missed `task_session_records_updated` envelopes. It makes the cached task session lists of its repository read again.
- Treat each later snapshot as a full collection reset.
- Commit a snapshot once so rows, activity, pending input, context, and counters use the same state.
- Per-task session-list queries own workflow records. Workspace session-list queries own repository records. The first live projection waits for task records and for the workspace record query to settle. A workspace record failure blocks chat actions, not healthy task sessions.
- Use `session-read-model/agent-session-workflow-records.ts` to project durable ownership into the collection. The host workflow launch service resolves source records when it prepares a launch.

This owner does not load catalogs, file status, diff, selected history, or page navigation. It does not select a native runtime protocol.

## Transcript history

Files: `history/session-history-loader.ts`, `history/session-history-load-policy.ts`, `history/session-history-freshness.ts`, `history/use-selected-session-history-load.ts`, and `state/queries/agent-session-history.ts`.

Task chats, workspace chats, and dialogs for registered sessions share one history loader and one store transcript. Selection does not make loaded history stale. Live events keep the transcript current while its repository stream stays connected.

A connection snapshot, observation failure, or repository switch marks retained history stale. A connection snapshot comes only from the first attachment or from a replay gap. Cancel older query reads before an open transcript can refresh. Hidden sessions stay stale until opened. Do not reload every retained transcript after a gap.

TanStack Query owns native history reads and their cancellation. The session store owns the merge with live messages. A late read cannot replace newer live text or tool results, restore removed responses or answered questions, or drop known tool timing. An unchanged merge keeps the message objects and transcript revision. Failed reads keep an actionable error and wait for a retry.

Unregistered external sessions and child transcripts keep their Query-owned read-only projection. They cannot create a registered session or replace its transcript.

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

`WorkspaceSessionStorePort.recordAcceptedMessage` validates and saves the generated title, monotonic `lastActivityAt`, and optional accepted model in one existing SQLite transaction. The workspace persistence policy publishes the returned record after commit. A publication failure cannot undo the save. Model-settings changes retain the stored `profileId`, including after compensation.

`agent-session-activity-persistence.ts` saves task and workspace activity from the ordered live stream. It tracks parent links, new input requests, status changes, and the latest final message. It keeps no transcript. Task saves publish the committed session list through `task_session_records_updated`; workspace saves use the existing updated-record event. Neither path reads native metadata or history.

## Host runtime lifecycle

Files: `packages/host/src/application/agent-sessions/agent-session-live-state-service.ts`, `agent-session-live-runtime-lifecycle.ts`, and `packages/host/src/ports/agent-session-live-adapter-port.ts`.

The live module owns runtime registration and ordered publication. Its internal lifecycle module owns registration leases, detach, and cleanup.

- Create one nominal registration lease for each adapter. Its bound mutation method retains the lease when copied. Prepared or detached leases cannot publish live changes.
- Detach and publish known removals under the live coordinator. Release native resources outside that coordinator.
- After a failed detach read, publish an authoritative snapshot of the remaining registrations. Keep the original read error and report any cleanup or publication errors.
- A host execution episode identifies a run. Renderer terminal state applies only to that episode. Current pending input takes priority.

## Workspace metadata and notifications

Files: `state/queries/workspace-sessions.ts`, `state/queries/workspace-session-updates.ts`, and `state/queries/agent-session-association.ts`.

One metadata subscription updates each shared query cache. Keep events that arrive during a record read until its cache commit. Discard a cancelled read's buffer once. Do not cancel a cold baseline or publish an incomplete baseline to apply an event.

Workspace navigation requires an exact stored runtime kind, external session ID, and working directory.

The host detects shared notifications for all open workspaces. Shells deliver the selected occurrences.

## Runtime readiness

Files: `state/queries/host-runtime-status.ts`, `state/host-runtime/host-runtime-status-owner.ts`, `state/providers/host-runtime-status-provider.tsx`, `lib/runtime-readiness.ts`, `lib/use-runtime-readiness.ts`, `packages/host/src/application/runtimes/host-runtime-service.ts`, and `packages/runtime-orchestration/src`.

Owns the host runtime status of each kind and the mapping to ready, checking, or blocked.

The host starts each enabled kind at host startup. One shared runtime of each kind serves every workspace. The frontend never starts, ensures, or polls a runtime.

Task-store checks keep their repository query keys and cached readiness across workspace switches. Opening the task composer is local UI, so a pending check does not disable New task. A confirmed task-store failure still blocks it.

The status owner subscribes to `openducktor://runtime-changed` before it reads the `runtime_status` baseline. It merges runtime and MCP bridge events into one Query snapshot by host instance and revision, so a late baseline cannot restore stale state. A reconnect reads one new baseline. A stream or read failure marks the status as not current.

`HostRuntimeStatusContext` is the only frontend runtime status context. Session actions and selected-session reads require the exact kind of that session to be `ready` and current. A runtime ID change or loss of ready state invalidates runtime-dependent Query data of that kind in every workspace.

Diagnostics start with an overview of all issues. The host group (agent runtimes, then Git and the OpenDucktor MCP bridge) comes before the selected workspace group (repository setup, then task store). Each runtime row shows its version, executable, state, last failure, and lifecycle action. `Restart` reads the restart impact, shows the affected live sessions in every workspace, and needs a confirmation.

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

- Live activity, pending input, context, and removal arrive as live-state messages. Only `agent-session-live-projection.ts` applies them to the Agent Studio session store. It also applies activity carried by a transcript event before transcript buffering. Transcript assembly cannot change activity.
- `projectObservedSessionActivity` in `session-read-model/agent-session-live-projection.ts` states the observed status rule. `projectSessionSnapshotActivity` in the same file states the snapshot policy: episode carryforward, pending-input override, terminal preservation, and message reset. `projectSessionTranscriptActivity` in `session-read-model/agent-session-live-activity.ts` states the transcript rule. The workspace activity projection in `features/workspace-activity/`, which feeds the workspace rail and the session list, reuses these rules. Agent Studio also records local stop intent, which the rail does not receive, so their transcript results can differ when those inputs differ. Change each rule in its one function, not in a copy.
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

Before a send to an idle or stopped session, build transient system prompt context. It does not start a runtime. The host rejects the send when the kind is not ready. This step does not attach observation, read a snapshot, resume a session, or classify pending input.

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
- A transcript stays in loading until it has a baseline or live rows. `loaded`, `stale`, and `refreshing` keep a visible baseline. A failed refresh keeps the transcript with its error state.
- `transcript/session-transcript-state.ts` owns runtime waiting, session loading, visible, and failed states.
- Use `selectedSessionIdentity !== null` for existence. Do not add `hasSession`.
- Keep `selectedSessionActivityState`, selected role, and `selectedSessionModel` as separate facts.
- Runtime kind and working directory belong to `selectedSessionIdentity`.
- `selected-session-context.ts` owns the task documents and the first document of the selected role session, not right-panel state.
- Read-only transcript history chooses a live session, runtime history, or an empty reason.
- `agent-chat/agent-chat-thread-state.ts` owns the renderable session, active key, notice, and reset window.

The selected view reads runtime, check, and read-model contexts. Do not pass those values through page shells. `AgentSessionReadModelStateContext` exposes one `sessionReadModelLoadState` and `reloadSessionReadModel`.

The repository read model key is repository plus task ID set. Task title, status, order, or document changes do not restart it. Durable records prove durable existence. The host snapshot proves live existence. Only a local `starting` session can exist for a short time without either source.

### Shared chat presentation

File: `components/features/agents/agent-chat/use-agent-chat-presentation.ts`.

Task and workspace wrappers use this hook for Claude skill mentions, child pending-input counts, runtime Recheck feedback, and the selected session accent. Child counts combine the activity snapshot with parent-visible requests and keep explicit child response identity. The task wrapper owns workflow notices, documents, and launch actions. Composer layout and transcript windowing stay with their existing owners.

### Rendered transcript cache

Files: `components/features/agents/agent-chat/use-agent-chat-transcript-model.ts`, `agent-chat-transcript-model-cache.ts`, and `agent-chat-transcript-model-build.ts`.

The app shell owns `AgentChatTranscriptCacheProvider`. Task and workspace chats share up to six rendered transcript models across page and workspace switches, keyed by full session identity and thinking-message preference. It updates cached inactive transcripts that came from the active repository session store. Unregistered Query-owned runtime history keeps its own rendered model. Selected and inactive transcripts use the same incremental update path and chunk limits. The cache retains the skill references used to display Claude skill mentions. Row keys use native message identity, so older history rows do not change the keys of visible rows.

- Background updates preserve cache recency. Selection determines which entries stay cached.
- Selection also schedules stale cached entries when their selected build stopped on deselection. Other inactive builds continue through the switch.
- Stop older work when a newer message revision arrives, the session leaves the active repository, the cache drops its entry, or the chat unmounts.
- A newly selected session shows current cached rows on its first render. If those rows still need work, show loading until they are ready. Keep already visible rows while a selected session processes a large revision.
- Cache updates do not read history or call the host. History reads stay with the selected history owner.

OpenCode live and history text-part rows keep the runtime's text, part IDs, and order. A final assistant event preserves separate parts and their whitespace when its text only trims a matching part. Changed final text still replaces a single part.

Final history text parts replace a live whole-message row with the same source ID. Keep each part's text separate when merging those rows. Keep live text when its history snapshot is still incomplete.

## Session navigation

Files: `state/read-models/session-navigation-read-model.ts`, `components/layout/sidebar/session-navigation-list.tsx`, `components/layout/sidebar/session-navigation-rail.tsx`, and `pages/sessions/sessions-page.tsx`.

The sidebar owns task and workspace session navigation. It shows each durable root once in Needs you, Running, or Recent. The scope control changes the list between the current workspace and all open workspaces. It does not change the visible conversation. Collapsed icons keep the same groups and expose session details on hover and focus.

`components/layout/sidebar/session-entry-preview.tsx` owns one interactive preview per sidebar. The preview uses cached task and session records and the existing workspace activity observer. It does not load history, start a runtime, or attach another live observer. Task previews share metadata badges with the task detail sheet and role buttons with the Agent Studio header. A role button opens its latest session with the full session identity, or its task context when no session exists. Model and effort use compact pills. ArrowRight or Tab enters the preview. Escape, Close, or an outside click dismisses it. Reply controls keep it open during input.

`session-preview-pending-input.tsx` reuses the chat question and approval cards. A reply checks the current live request and uses its workspace, runtime kind, working directory, and external session ID. Child requests keep their child identity. The preview sends through the typed host live-reply commands without loading a transcript or changing the visible workspace. Successful replies wait for the live stream to clear the request. Failed replies show their error and keep the draft. A lost stream or failed status read disables replies.

The app shell also owns `contexts/DiffWorkerProvider.tsx`. Page and workspace switches retain the syntax worker pool and its bounded highlight cache. Diff preloads handle their promises. A failed preload reports an error while its view is open. Closing that view stops error reporting for its pending work.

`pages/agents/agent-studio-navigation-state.ts` resolves the committed task selection. Task and workspace views render one conversation without browser tabs. `components/features/agents/session-view-controls.tsx` supplies the bottom panel and right panel toggles in the session header. The task header also shows the link of the pull request of the task. The header stays visible during a file preview. Workspace session actions expose rename and archive. Archive uses the existing worktree confirmation and unsaved-edit guard.

`components/features/repository-actions/session-repo-actions.tsx` supplies the repository action button in both session headers. It reads actions from the repository config query, so a settings save updates it without a reload. It runs an action through the session panels controller, which opens a new terminal tab at the end of the bottom panel. The terminal scope gives the reason when the session has no usable working directory.

`pages/agents/agents-page-session-tabs.ts` owns workflow roles and session history choices. It does not own a task tab list.

`agent-studio-state-writer.ts` orders saved navigation actions for one workspace. The host applies each action to the latest config under serialized writes. `use-agent-studio-workspace-state-save.ts` saves the selected task and session through this path. The UI preserves legacy `openTaskIds` in the existing record shape but does not edit them. Background starts appear through their durable session records. They do not write tab state or depend on the retired background-tab setting. A missing requested task keeps its URL and shows an unavailable view without replacing the saved selection.

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

## Build tools state

Files: `pages/agents/shell/use-agents-page-build-tools.ts`, `pages/agents/right-panel/use-agents-page-right-panel-model.ts`, and `pages/agents/shell/use-agent-studio-git-conflict-header-model.ts`.

The page shell owns the build-tools snapshot and the git actions. The right panel model reads them and owns the Document, Diffs, Files, and CI Checks tool models. The Diffs view reads Git data only while the Diffs tab is selected in the shown right panel.

Rules:

- The chat header reads the git conflict from the page shell. Do not send right panel state to the page shell from an effect.
- The workflow model builds the git conflict quick action. The header model hook adds it while the git actions report a conflict.
- Show the git conflict quick action only while the right panel is open. Git data does not refresh while the panel is closed.
- Keep git state through a right panel toggle or a Diffs tab close, so a running git action keeps its result. Both session kinds use `pages/agents/use-agent-studio-git-actions.ts`. Task workflow policy stays in the task adapter.
- Show action errors, a force push confirmation, or a local git conflict only in the repository and working directory where the action ran. Pull/rebase confirmations also belong to the original branch identity. Reset confirmations also belong to the original branch identity, comparison target, and displayed snapshot.

`pages/workspace-sessions/workspace-session-content.tsx` owns `components/features/agents/use-workspace-session-tools.tsx` outside the panel layout. This hook keeps the shared Git action controller mounted when the tools view closes. Hidden tools disable comparison and diff reads and remove focus refresh listeners. An operation that finishes while hidden invalidates its original directory without reading it again. Reopening the tools reads current Git data.

Deferred refreshes check the current view before each read. Branch and settings refreshes wait while tools are hidden. A repository, directory, or branch change discards work for the previous view.

Keep this hook in the session shell. Closing or hiding the Diffs tab only unmounts its view. Conflict assistance uses the same controller and keeps task workflow policy in the task adapter.

`features/git-conflict-resolution` shares conflict controls and core prompt instructions. The task adapter retains the permitted Builder launch. The workspace adapter uses the existing saved-chat action owner through `use-workspace-conflict-chat-actions.ts`. A draft starts the same saved chat, and a direct request leaves the composer draft intact. Selection guards cancel an unsent request after a context change, while an accepted startup stays in its original workspace cache.

Git status supplies the effective conflict directory but uses the comparison branch as its target. The frontend marks that target unavailable. The retained conflict controller keeps operation and branch facts from the original command and updates its file paths from Git status.

## Session panels

Files: `features/session-panels/panel-tab-kinds.ts`, `session-panel-layout.ts`, `session-panel-layout-store.ts`, `use-session-panels.ts`, `use-session-panel-visibility.ts`, `session-panel.tsx`, `session-panel-split.tsx`, `session-panel-drop.ts`, and `session-panels-root.tsx`.

Owns the tabs of the right panel and the bottom panel of task and Workspace Session pages. The task page shell and the Workspace Session view each call `useSessionPanels` with the owner, the selection key, the terminal model, and the kinds that the page cannot show now. The pages give the content of each tool tab.

Rules:

- `PANEL_TAB_KIND_RULES` is the only place that names a tab kind. It holds the label, launcher description, icon, number of tabs, allowed panels, allowed owners, and default state of each kind. A later kind adds a rule and a content renderer. A page names only the kinds that it cannot show now, such as CI Checks without a linked pull request.
- One layout belongs to each task, for all its role sessions, and one to each Workspace Session. Each role and each chat remembers its selected right panel tab. A role without a selection starts on its default tab. When the remembered tab closes or moves away, the panel selects its first tab, also after a restart.
- `reconcileSessionPanelLayout` applies the rules to a layout on each input change. It keeps the position of a kind that is not available, so CI Checks gets its position back. It drops a terminal tab only when the terminal list proves that its terminal ended.
- `canPlacePanelTab` is the one placement check for the launcher and moves. `canMovePanelTab` is the one move check for drag and drop and the move action. The launcher shows no card for a unique kind that is already open.
- The layout store keeps the layouts of all owners for the app run and saves tool tabs in `localStorage`, one record for each owner. It does not save terminal tabs or the New tab. The sessions page removes the records of tasks, chats, and workspaces that no longer exist. It removes the records of a workspace only when the open and the closed workspace lists are both current. It reads the IDs of all tasks from `task_ids_list`, because the Kanban task list hides old closed tasks.
- The right panel open state is global. The bottom panel visibility belongs to the selected owner and resets when the owner changes. The bottom panel hides when it loses its last tab, by a close, a move, or a terminal list without its terminals. An empty bottom panel that the user opens stays open.
- Each panel has one presence: `opening`, `open`, `closing`, or `closed`. A panel is visible in all states except `closed`, so its content does not change while it slides out. The Ctrl+` shortcut, an owner change, and the first render go to `open` or `closed` at once.
- `SessionPanelSplit` places the main area and one panel. While the panel opens or closes, both change size together with the sheet motion tokens, and the panel content keeps its open size at the outer edge. The size transition is on only during that move, so a drag on the separator stays direct. The split calls `onSettled` when the move ends. It calls it at once when no transition runs, as with reduced motion or a panel that a drag made zero wide. When the user makes an open panel zero in size with its separator, the split calls `onCollapsed`, and the panel hides at once.
- The terminal model owns terminal processes, discovery, close, and viewports. The panels own terminal placement, order, and selection.
- A terminal that runs a command, as the live activity stream reports, opens the close confirmation at once and changes nothing behind it. Any other terminal tab hides at once while the host ends its terminal. If the host still asks for a confirmation, the tab comes back with the dialog.

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
- A saved session model that the catalog no longer offers changes only when the user sends. The send applies the catalog replacement first. Viewing the session never sends a model update, because a model update can resume an idle session.

Build-tool worktree reads belong to `features/agent-studio-build-tools/use-agent-studio-build-tools-worktree-snapshot.ts`. Their key is repository, task ID, and task version. Git refresh belongs to `use-agent-studio-build-worktree-refresh.ts`. Transcript display state does not control either read.

## Session actions

Files: `handlers/session-actions.ts`, `handlers/send-agent-message.ts`, `handlers/stop-session.ts`, `handlers/session-model-actions.ts`, `handlers/pending-input-actions.ts`, and `handlers/public-operations.ts`.

Owns interactive send, stop, model update, pending-input replies, and presentation. `features/session-start` owns launch requests.

The host owns complete workflow execution.

The shared send handler checks a typed accepted-message failure before ordinary send recovery. It upserts the native message once and adds a scoped failure notice. It completes the send action without restoring the accepted draft or resetting running state and pending input. Both task and workspace actions use this handler. Runtime-service conversion checks the exact session reference and preserves accepted model fields.

The sender returns `AgentMessageSendReceipt` after acceptance, including queued state and any later host failure. Its optional `assertCanSubmit` guard checks the captured recipient and shared session send policy before preparation and immediately before transport. Guards and receipts stay in the frontend. A task post-start workflow carries the receipt so conflict assistance does not treat startup as delivery or retry an accepted message.

Before sending to a stopped repository or workflow session, the shared send handler resumes the same native session. It rejects an unbound session because that session has no repository or workflow scope. It checks repository continuity and retains newer live activity and pending input. For a workflow session, the host verifies that the task owns the session before it resumes it. A failed resume sends no message.

Rules:

- Action availability uses task, role, launch action, and loaded session. Transcript loading belongs to the selected view.
- An existing session gets runtime capability from its runtime data or `AgentSessionState.runtimeKind`, not the composer draft.
- A send, model update, or reply requires loaded session state. Missing state is an invariant error.
- Start requests capture workspace and task identity before host admission.
- The host saves ownership before the first instruction and preserves it after a send or publication failure.
- Runtime events cannot attach an unrelated root session.
- The runner presents the host result. If the runtime did not get or rejected the first instruction, the runner offers Retry. Retry sends the returned instruction through the shared send handler. Other send failures show the host error without Retry.
- Kanban and the task content of the Sessions page supply the Retry toast before notification delivery. The runner then marks the `failure.noticeId` as handled, so the host notification skips its in-app toast. A composer start restores the draft in the new session instead.
- Manual starts and Autopilot use the same host launch service.
- Sessionless send uses the same start-availability rule as an explicit start.
- The start modal reads runtime definitions from runtime availability context.
- Action state owns busy, waiting, queued, and send-block rules. It does not copy identity or runtime-data loading.

## Read-only transcripts

Files: `components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-session-history.ts`, `use-runtime-transcript-interactions.ts`, and `use-session-transcript-surface-model.ts`.

Owns read-only history, preference for an existing live session, live pending input, and replies through a runtime context reference. It does not create global sessions, attach observers, resolve routes, or own workflow status.

## Task session records

Files: `state/queries/agent-sessions.ts`, `session-read-model/task-session-records.ts`, `session-read-model/use-task-session-records.ts`, `hooks/use-repo-session-read-model.ts`, and `session-read-model/agent-session-workflow-records.ts`.

Owns per-task durable record queries and task session history for the Sessions page, the session list, Kanban, task details, and Autopilot.

Rules:

- Do not read session history from `TaskCard.agentSessions`.
- Repository startup keys record reads by task ID only.
- Reset invalidates the exact task record query. It does not call a session refresh command.
- `useAgentSessionListQueries` is the only fan-out for task session records. `useTaskSessionRecords` and the session list read through it. `useRepoSessionReadModel` attaches the live stream and commits the collection.
- Apply durable records before and after each live projection, then commit once. The first pass admits durable roots. The second pass restores durable workflow fields after live status is applied.
- Reject an unknown live root. Accept an unknown descendant only when its declared parent is already registered.
- Skip a record update when its read is unloaded, failed, or stale because it cannot prove deletion.
- Keep `liveReported` on session state. Do not add a presence store.

## Session navigation

Files: `pages/sessions/sessions-page.tsx`, `pages/sessions/use-sessions-workspace-match.ts`, `features/session-navigation/session-navigation-target.ts`, `features/session-navigation/visible-session-target.tsx`, `features/session-navigation/use-session-navigation-model.ts`, `state/read-models/session-navigation-read-model.ts`, and `components/layout/sidebar/workspace-sidebar.tsx`.

The Sessions page shows one content at a time. The `kind` query value selects task content or workspace session content, and that content owns the other query values.

Rules:

- Build each session address with `buildSessionNavigationHref`. A task session address names the workspace, task, role, and complete session identity. A task context address names the workspace and task, and it can name a role. A workspace session address names the saved record ID.
- Task content keeps the complete session identity in the address on each write.
- An address or saved selection without the complete identity opens a session only when exactly one session of the task has its external ID. More matches show an error.
- Keep old `/workflows` and `/chats` addresses as redirects that add the matching `kind`.
- The address names its workspace. A new address for another workspace selects that workspace. A workspace change from elsewhere replaces the address and drops the old selection, also while the address still waits for its own workspace.
- A workspace switch that fails or that another workspace action interrupts shows the failure with Retry.
- Content publishes the visible target after its own selection commits. The session list marks that target as selected. A pending, cancelled, or failed navigation never marks another entry.
- The session list reveals the selected entry before paint when it opens or the sidebar expands or collapses. Status, group, recency, and record updates keep the user's scroll position.
- Entry keys and the selected key both come from `sessionNavigationTargetKey`.
- A requested workspace session that is missing shows as unavailable. Only a restored selection without an explicit request can fall back to the first chat.
- Task and workspace content use `features/session-navigation/use-session-navigation-recovery.ts` and `session-navigation-error.tsx` for scoped navigation failures and explicit retries. Each scope keeps its storage and selection policy. A storage failure blocks content. A workspace selection-storage failure also blocks address normalization, including an explicit workspace session address.
- Task and workspace transcripts use `components/features/agents/agent-chat/use-failed-transcript-action.ts`. A loaded history failure retries history. A missing session with a failed observation reloads the read model. A workspace target mismatch also reloads the read model. Rejected retries remain visible in the selected content.
- A failed chat-list refresh keeps the chats and their content, and shows the error with Retry beside them. Only a failed first read replaces the chats with an error.
- Content asks about unsaved edits before its own selection changes. A sidebar entry and a created chat ask before they navigate. A notification asks only when its target replaces the content with another workspace, another content kind, or another page.
- The session list reads tasks, task session records, workspace session records, and native activity times through their shared Query keys. `useAgentSessionListQueries` is the one fan-out for task session records.
- A task session list without data reports its repository's batch read until that read succeeds. A list with data keeps it while the batch read for other tasks loads or fails.
- Live facts come from the snapshot of the workspace activity observer that also feeds the workspace rail. Do not attach another live observer for navigation.
- Only saved task roots, saved non-archived workspace roots, and blocked tasks without a saved session become entries. Subagent questions and permission requests count for their root.
- An entry has one group. Needs you comes before Running, and Running comes before Recent. Keep the Needs you and Running headers visible in both sidebar modes, also when their counts are zero. Recent appears when it has entries. Lost live status keeps known attention but shows no confirmed running or idle state.
- An entry in Needs you uses a warning surface and shows its attention reason. Selection strengthens the section color: amber for Needs you, blue for Running, and neutral for Recent. A thicker inset outline and a contrasting checkmark in the top-right corner identify the current session in both sidebar modes. The checkmark overlays the corner and does not reserve space in the row. Recent rows have neutral outlines and gaps between them. Rows have no left edge accent. An attention entry never uses the running style. Hover uses the theme's interactive surface tokens and keeps the section color.
- Session additions reveal in place for 200 ms. Removals collapse for 150 ms. A section move can collapse the source and reveal the destination at the same time. Motion presence retains outgoing visuals until the native CSS transitions finish. Outgoing visuals are inert and hidden from assistive tools. Set each incoming element's entrance state in its initial attributes before any style read.
- Reduced motion uses only opacity. Initial reads, scope changes, sidebar mode changes, selection, and group toggles stay instant. Transitions retarget from their current position when a session returns before its exit finishes.
- Expanded session rows use the task's issue type icon or `MessagesSquare` for a workspace session. Task icons use the shared Kanban issue-type colors. Their subtitle shows the workflow role, when present, and the workspace name. Collapsed task session icons keep their workflow role.
- The workspace rail and session hover cards use `WorkspaceTile` with their own size variants.
- Expanded rows and collapsed icons use the same session details card on hover and focus. It shows the full title, workspace, session type or task role, attention or activity state, time, and faults. The card closes when its row or section starts to leave. Session rows and attention badges do not use native browser tooltips.
- A session fault stays on its entry also when the session has no live facts.
- A failed status read makes the entry status unavailable. For a session with a kept snapshot, the snapshot `statusUnavailableReason` tells. Without a snapshot, a fault with `statusUnavailable` tells. Context, todo, and title updates keep that status. Only a status update clears it.
- Known questions and permission requests keep such an entry in Needs you. Other session faults keep the live status.
- All workspaces scope names closed workspaces and incomplete removals with their recovery action. The collapsed list keeps them behind one warning button.
- Only a successful, current empty session read adds a blocked task without a saved session.
- New task keeps the workspace that was active when it opened. It names that workspace and blocks creation while another workspace is active.
- The expanded sidebar keeps New task as a split button. The collapsed sidebar has one plus button that opens the action menu, with New task first. Both menus show action labels without descriptions or a heading. Closing a creation dialog restores keyboard focus to its action.
- Activity time comes from the record's `lastActivityAt`. Older task sessions use `startedAt`; older workspace sessions use `createdAt`. The list labels those dates as start times. Metadata edits do not change the date.
- The host saves activity at message and turn boundaries, using the event timestamp. New input requests use the host clock because their snapshots have no event timestamp. Restore baselines, streaming output, repeated status reports, and idle cleanup do not move the date.
- Navigation does not load history, start sessions, resume sessions, or change runtime state.

## Startup sequence

1. Read task IDs from the task store.
2. Read task and workspace session records through their shared Query keys.
3. Attach to the generic host-event channel, then request a repository live snapshot. On the first attachment of the repository, the host reads exact root references from both durable record kinds.
4. On that first attachment, each runtime adapter reads only registered roots and verified descendants. Apply durable records before and after the live projection, then commit once.
5. Derive rows, activity, pending input, current context usage, and counters from that commit.
6. Apply ordered changes on the same channel. After a browser reconnect, apply the replayed changes. Attach again only after a replay gap or a host change.
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
| Existing idle send prepares prompt context | `handlers/prepare-session-send.test.ts`, `handlers/session-actions-send.test.ts` |
| Runtime status follows events by revision | `state/host-runtime/host-runtime-status-owner.test.ts` |
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
