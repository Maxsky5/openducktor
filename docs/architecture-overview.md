# Architecture and data flow

Use this document to find the owner of a rule and trace a user action across packages.

OpenDucktor supports OpenCode, Codex, and Claude runtimes. OpenCode is the default. `packages/frontend-core` holds the client behavior that all clients share. `packages/frontend` is the shared browser UI. Electron and `packages/openducktor-web` provide the shells. `packages/host` serves both shells. The desktop app runs on macOS, Windows, and Linux. `apps/mobile` is the native iOS and Android client of a remote host.

This guide covers the desktop app, the browser runner, and the mobile app. Read [the marketing website guide](../apps/marketing-website/README.md) for the public Astro website.

## Layer ownership

| Layer | Main code | Owns | Does not own |
|---|---|---|---|
| UI | `packages/frontend/src/pages`, `packages/frontend/src/components` | Rendered state and local interaction | Workflow rules and status transitions |
| Theme | `packages/theme/src/*` | The desktop theme tokens that the app and the product scenes share | Components and page styles |
| Product scenes | `packages/product-scenes/src/*`, `packages/product-scenes/styles/*` | Stateless copies of the product UI, scene timelines, and their players, for the website and the app tour | Host data, live state, and app stores |
| Frontend state | `packages/frontend/src/state/app-state-provider.tsx`, `packages/frontend/src/state/operations/*` | UI state, task and workspace operations, provider composition | Schemas, task mutations, source live runtime state |
| Frontend core | `packages/frontend-core/src/*` | Host connection lifetime, query caches, live session projection, history merge, notification policy, connection recovery, drafts | Presentation, device APIs, workflow policy, source live runtime state |
| Contracts | `packages/contracts/src/*` | Zod schemas for tasks, sessions, workflows, host commands, and MCP data | Runtime control and workflow policy |
| Core | `packages/core/src/ports/agent-engine.ts`, `packages/core/src/services/*` | Shared ports, ODT tool name helpers, and services | Workflow definitions, role policy, and task-store adapters |
| Workflows | `packages/workflows/src/*` | Pure workflow evaluation, the built-in definition, role policy, prompts, and presentation rules | I/O, storage, React, runtime descriptors, and native runtime calls |
| Clients and runtime adapters | `packages/host-client/src/*`, `packages/adapters-opencode-sdk/src/*`, `packages/adapters-codex-app-server/src/*` | Host client and native runtime protocols | Workflow policy and shell transport |
| Host | `packages/host/src/*` | Command router, Effect services, live session state, runtime drivers, process, files, Git, task store, and MCP | Frontend cache and public schemas |
| Runtime orchestration | `packages/runtime-orchestration/src/*` | Shared runtime lifecycle, registry, admission, and lifecycle plans | Platform processes, task policy, and settings persistence |
| Remote host | `packages/remote-host/src/*` | Remote access, connection lifetime, the host channel, and shared HTTP and WebSocket transport | Workflow policy and runtime lifecycle |
| Shells | `apps/electron/src/*`, `packages/openducktor-web/src/*` | The host channel listener, shell IPC, preload, HTTP, renderer start, URLs, and previews | Workflow policy and task-store rules |
| Mobile client | `apps/mobile/src/*`, `apps/mobile/modules/*` | Native UI, saved hosts, native transport, device storage, app lifecycle | Host work, workflow policy, and shared client behavior |
| MCP | `packages/openducktor-mcp/src/*` | stdio, schema checks, bridge readiness, and `odt_*` calls | UI state and direct SQLite access |

The host supplies one `RuntimeDriver` per runtime kind to the shared orchestrator. [ADR 0010](adr/0010-own-runtime-orchestration-in-a-platform-independent-package.md) defines this boundary. Both shells use the remote host package. Read [the remote host protocol](remote-host-protocol.md) before you change that transport.

## Shell startup

`packages/frontend` exports `bootstrapOpenDucktorShell(...)` and the `ShellBridge` contract. The bootstrap creates one `ClientConnection` for the selected host, reads settings for the theme, selects browser or hash routing, and renders the app under `ClientConnectionProvider`. A host change from a local host first saves drafts and stays on the page when a save fails. A remote host keeps its drafts in page memory, so its host change does not wait for them. Then the host change unmounts the app, disposes the connection, and reloads the document. See [the frontend core](#frontend-core).

`apps/electron` supplies a loopback host channel listener for its windows, shell IPC, context isolation, renderer sandboxing, and host cleanup. `packages/openducktor-web` starts a loopback host, injects config, serves the frontend, and maps one host channel WebSocket per tab and HTTP file reads to the same bridge.

`apps/mobile` connects to one saved host at a time. For that host, it builds one `ClientConnection` with `createRemoteHostConnection`, a native transport, and device storage. Under its native UI, it uses the same frontend-core owners as desktop. Read [the mobile app](../apps/mobile/README.md) and [ADR 0012](adr/0012-build-the-mobile-client-as-an-expo-shell-over-frontend-core.md).

## Shared ownership rules

- Zod schemas in `packages/contracts` define public data.
- Effect defines host execution, typed failures, resources, and Promise conversion.
- TanStack Query defines client cache keys, stale times, in-flight request deduplication, and invalidation. Each host connection has its own query client.
- React context and local stores hold UI state. Host runtime adapters hold the source live session state.

Read [ADR 0002](adr/0002-use-effect-in-the-typescript-host.md) and [the TanStack Query cache strategy](tanstack-query-cache-strategy.md) before you change these boundaries.

## Frontend core

`packages/frontend-core` (`@openducktor/frontend-core`) owns client behavior that desktop, browser, and mobile clients share. [ADR 0011](adr/0011-own-shared-client-behavior-in-a-platform-independent-package.md) records the decision.

The package runs without DOM, Node, or Bun APIs. Its dependencies are contracts, core, workflows, the host client, path support, TanStack Query, React, Zod, and Zustand. `packages/frontend-core/src/platform/platform-globals.d.ts` lists the standard globals that a client platform must supply.

This diagram shows how a shell builds one client connection.

```mermaid
flowchart TD
  Shell["Shell bridge"] --> Conn["ClientConnection"]
  Ports["Platform ports"] --> Conn
  QC["Query client"] --> Conn
  Conn --> Provider["ClientConnectionProvider"]
  Provider --> Views["Views and hooks"]
```

| Area | Folder | Owns |
|---|---|---|
| Connection | `connection/` | `HostConnection`, `ClientConnection`, query client defaults, React provider and hooks |
| Platform ports | `platform/` | `ClientFeedback`, `ClientStorage`, `DeviceFileReference`, `NotificationBridge`, `AppVisibility`, platform globals |
| Caches | `queries/` | Query keys, options, cache sync, and invalidation |
| App state | `app-state/`, `tasks/operations/` | State contexts, slice providers, and task operations that each platform composes |
| Sessions | `sessions/`, `workspace-activity/` | Session store, live projection, history, transcript, session actions, session navigation and read state |
| Session start and send | `sessions/start/`, `sessions/send/`, `sessions/model-selection/` | Start choices, validation, and launch; message send rules; model, effort, and speed choices |
| Task workflow | `tasks/workflow/`, `tasks/board/`, `tasks/presentation/` | Task actions and their session starts, task card models, and status labels with a tone for each status |
| Autopilot | `autopilot/` | Held-outcome reads and the first-message recovery |
| Recovery | `recovery/`, `tasks/` | Remote host connection, recovery barrier, task streams, notification replay |
| Notifications | `notifications/` | Occurrence preparation, delivery policy, failure state |
| Drafts | `drafts/` | Chat drafts, queued-message edit drafts, inline comment drafts |

Connection rules:

- A `ClientConnection` binds one host connection to one query client, one device storage scope, and its draft stores. `connectionHost(queryClient)` returns the host client of the connection that owns a query client, so a late response stays in its own cache. Query options and loaders take no host override, so one cache key always reads the host of its own connection. Named session ports, such as `AgentSessionReadPort`, stay explicit.
- Code outside React receives the connection, its query client, or its host client as a parameter. Code in React reads it with `useClientConnection`, `useHostClient`, or `useHostConnection`. Module-level tables key each entry by query client, so each entry belongs to one connection.
- Frontend stores that keep host state, such as the command palette Recent list, session panel layouts, and the selected workspace session, read `ClientConnection` storage. `perConnection` in `packages/frontend-core/src/lib/per-connection.ts` gives each connection its own store. The mobile app uses it too.
- React effects under `ClientConnectionProvider` own the event subscriptions. A platform unmounts that tree before it disposes the connection. The frontend uses `releaseShellConnection` for this order.
- `saveDrafts()` writes every unsaved draft now. It rejects with an actionable message when a draft could not be saved, and that draft stays in memory.
- `dispose()` starts `saveDrafts()` before its first `await`, cancels local reads, clears the cache, and releases the host transport. It rejects when a step failed, including a draft save. It sends no command that stops or changes host work, so admitted host work continues. Only the draft save can stage the attachments of an unsaved draft.
- A local host stores drafts in device storage. On desktop and web, a remote host stores drafts in connection memory. Its connection sets `saveDraftsOnDispose: false`, so disposal drops those drafts and does not wait for their attachment uploads. The mobile app stores the drafts of each saved host in a device store for that host. Its connection also sets `saveDraftsOnDispose: false`. Before a host switch, `closeSession` in `apps/mobile/src/host-session/host-session-owner.ts` saves the drafts only when the user keeps them, so a removed host or discarded drafts upload no attachment.
- Platforms supply transient feedback, device storage, app visibility, the attachment stager, the remote transport, and notification delivery adapters. A device file reference is never a host path. The stager returns the host path.
- UI facts, such as key labels, the command palette shortcut, scrollbars, and theme, come from the device (`lib/device-platform.ts` in the frontend). Host facts, such as host paths and the host platform, come from host data. Terminal key mapping uses the host platform, because its line-editing input goes to the host shell.
- The frontend keeps presentation, provider composition, routing, terminals, generated-image decoding, and the browser implementations of the ports.
- The session and activity providers read `WorkspaceScopeContext`: the open workspaces and the selected one. The desktop `WorkspaceStateProvider` supplies it with its workspace administration. The mobile app supplies only this scope.

## List tasks for the Kanban board

1. `useTaskQueryReadModel` observes `repoTaskDataQueryOptions`. The initial stream snapshot fills the shared query cache. The render query reuses this data without a second request. If the stream cannot start or has not claimed the selected repository, the repository load fills the cache. Manual and event refreshes use `TaskViewSync`.
2. `repoTaskDataQueryOptions` calls `tasksList({ workspaceId, repoPath })` on the host client of the connection that owns the query client. The host reads `kanban.doneVisibleDays`, and SQLite filters old closed tasks before the host builds task rows.
3. The host client of the connection sends commands over a host channel: the shell's own host channel, or the channel of the remote work endpoint.
4. `packages/host-client/src/task-client.ts` maps the call to `tasks_list`.
5. The shell calls the host command router.
6. The host validates the full workspace identity against `<config-root>/database.sqlite` and reads through the scoped `TaskStorePort`.
7. The host adds `available_actions` and `agent_workflows` from the task workflow of each task.
8. TanStack Query caches the result. Frontend read models render columns and actions.

The frontend renders `availableActions`. It does not derive transition rights from status. Host SQLite adapters own database paths, schema setup, and records. Host events drive client cache updates.

## Start an agent session

The host owns complete workflow launches. The shared client launch module prepares a declared message after branch selection and before host dispatch. Task actions and Studio pass the launch intent and selected choices through that interface.

1. The frontend sends one request with the requested workspace, task, action, user choices, and instruction.
2. The host validates the request and starts an independent worker. Launches for one task run one at a time, in arrival order. A fresh workflow role creates or reuses the task worktree and runs its worktree-creation actions through terminals.
3. The worker starts, resumes, or forks the selected native session and saves task ownership.
4. The worker sends the first instruction through the normal workflow send policy.
5. The host returns the result.
6. Renderer attachment receives ordered live state and transcript events through the existing channel.

Launch rules:

- A frontend workspace change does not cancel an admitted workflow launch.
- Stop cancels a launch that targets the stopped session. A canceled launch sends no first instruction. If the runtime accepted the first instruction during the Stop, settlement stops the session again.
- Host shutdown interrupts launch workers and waits for their cleanup before it stops runtimes and the task store.
- A launch asks the runtime adapter to return only after the runtime accepts the first instruction. The Codex adapter waits for the `turn/start` or `turn/steer` answer. The Claude and OpenCode adapters return their normal send receipt. A later runtime failure shows as a session error.
- Only a fresh decision can name a target working directory. The host accepts only the canonical task worktree.
- Only Autopilot launches that use the configured default model check the runtime catalog.
- A reuse launch refuses a session that waits for an approval or a blocking question. Its first instruction answers open background questions.
- Each runtime adapter calls the `onSent` send option when it sends the native request that carries the message.
- If the first send fails before `onSent`, or the runtime rejects the instruction, the result returns the instruction. The frontend can send it again through the normal send path. A Codex JSON-RPC error is a rejection.
- Other failures after `onSent`, such as a timeout or a lost reply, do not prove that the runtime did not get the instruction. The result does not return it. The error tells the user to inspect the session.
- The host keeps the last launch failure of a live saved session in memory while it runs. The session snapshot carries it as `launchFailure`. A browser that attaches later also shows it. The next accepted message clears it.
- The host sends one session error notification for each new `launchFailure`, also after the session goes away and comes back. A launch failure is host state, so it does not end the runtime turn.
- A failed launch result carries `failure.noticeId` only when the host showed the failure in the live session. Without it, for example when the session could not resume, the browser shows and notifies the failure itself.
- When the browser shows a Retry toast for a reported failure, the host notification goes out without its in-app toast.

Explicit startup progress stays in connection memory. Host commands publish cumulative `openducktor://session-startup-progress` snapshots with an attempt ID, operation ID, host instance, revision, ordered steps, and saved-session ownership. Results and typed partial failures carry the same facts. Automatic launches and ordinary session selection do not create attempts.

The shared startup owner subscribes before dispatch. A foreground setup dialog shows the attempt until preparation and any initial instruction settle. A background task start closes its dialog at submission and keeps progress in the app. Navigation changes presentation only. Workspace creation saves a draft, then prepares that record without a message before handoff. Failure keeps the saved record and its recovery actions.

A prepared handoff names the exact native target, runtime instance, and live publication sequence. The destination preparation owner adopts it only after the existing repository live source covers that target. A relevant live gap, target removal, runtime replacement, or owner release invalidates this evidence. A temporary connection suspension does not start another session.

Session rules:

- `spec`, `planner`, and `qa` reject mutating permission requests. If the reply fails, keep the request open and emit a system error.
- Register and start the live adapter before the runtime can emit events. Release it when the runtime stops.
- Read transcript history only for the selected session. A history read does not discover pending input or delay live state. Mobile also reads the history of active and recent sessions after a live gap, before the user opens them (see [the agent orchestrator module map](agent-orchestrator-module-map.md#transcript-history)).
- Keep rendered transcripts current out of view with the transcript cache keeper. Mobile also builds the transcripts of active sessions before the user opens them, so a running session opens on its latest messages at once (see [the rendered transcript cache](agent-orchestrator-module-map.md#rendered-transcript-cache)).

## Autopilot

The host runs Autopilot for every open workspace while the host runs. Browser presence and workspace selection have no effect. The browser shows outcomes and offers recovery controls.

1. The task store reports each status change and its signal to `AutopilotService` when the change commits. The mutation still holds its repository mutation gate. A later failure or interruption of the mutation keeps the report.
2. Autopilot reads the rules saved at that moment for the signal. Each configured action gets one attempt. A change without a signal starts nothing.
3. The attempt waits until the reporting mutation and its publication leave the gate. Then it queues in the workflow launch lane of its task with the automatic policy, a start check, and a kickoff instruction.
4. At its lane turn, a start check skips the attempt if the workspace closed or was removed, the task was deleted, the rule was disabled, or the task had a later status change. The check reads the workspace state again after its task read.
5. The host keeps the latest outcome of each task and action. It sends each outcome to all clients as an `openducktor://run-event` payload and publishes the session started or session error notification.

Rules:

- Only `set-spec`, `set-plan`, `build-completed`, `qa-rejected`, and `qa-approved` changes can qualify. Only the `qa-rejected` operation proves a QA rejection, not a task status.
- A change counts when it commits, also when later work in the same operation fails.
- Task list loads, host start, and workspace add or reopen never start an agent.
- Duplicate prevention identifies the committed change. Clients cannot create an attempt, so replay and more browsers cannot repeat one.
- Autopilot never retries an attempt and never cancels a started launch.
- The public `agent_session_workflow_launch` command accepts only manual launches.
- The `openducktor://run-event` channel carries only Autopilot events, and each shell parses them with the contract.
- A settings save applies to changes that commit after the save and to the start checks of waiting attempts. A save during a mutation does not change how a change that committed before it is evaluated.
- A workspace close skips its waiting attempts. A reopen gives the workspace a new generation, so those attempts never start. A removal discards attempts and outcomes.
- All Autopilot state stays in host memory. A host restart loses waiting attempts and outcomes. The user starts a lost step from the task actions.
- `autopilot_state_read` returns the held failed and skipped outcomes of one workspace. A client reads it when it attaches, selects a workspace, or reconnects after missed run events.
- `autopilot_recovery_claim` lets one client send the unsent first message of a failed launch again. A client claims only while the workspace of the outcome is selected, because the send path needs it. It does nothing while a send runs or after one succeeds.
- A failed launch that a client can still recover appears again when the user selects its workspace again.
- A save that changes the rules sends an `autopilot_settings_saved` run event, and each client then reads the saved rules again. A reconnect after missed events has the same effect. An open settings view shows the saved rules unless the user edited Autopilot there. A failed read shows in the section. [The TanStack Query cache strategy](tanstack-query-cache-strategy.md#workflow-data) gives the cache rules for the saved rules.
- A settings save sends Autopilot rules only when the user edited them. The host keeps the saved rules when the save omits them, so a client with old rules cannot replace a newer save.
- A failed outcome carries the id of its host error notification. The client that shows the failure marks it handled, so the notification does not show a second in-app toast.

## Change task workflow state

A task workflow is a data definition. Its Zod schemas and evaluation types are in `packages/contracts/src/workflow-*.ts`.

`createWorkflow` in `packages/workflows` validates, freezes, and compiles a definition. A definition has a `schemaVersion` for its format and a `revision` for its content. Evaluation reads explicit facts and artifact states. An unknown fact, a wrong value type, an invalid reference, or a missing value that evaluation reads fails with an error.

Every workflow has the core states `open` and `closed`. `TASK_OPEN_STATE` and `TASK_CLOSED_STATE` in `packages/contracts` name them. A new task and a reset task start in `open`. `closed` is the only terminal state. A definition has no initial state field and no terminal flag. It declares both core states in `states` with their labels, tone, and notification, and the board layout gives them a position. `createWorkflow` rejects a definition without them.

Each state change uses a named event. An event declares its source states, ordered guards, and ordered outcomes. A denial names the failed guard. The first matching outcome keeps the state or selects the destination. No event leaves `closed`. An event lists `closed` only to admit a repeat. An event action is available only when its event admits the input. View actions never authorize writes.

The definition also declares the data that host and frontend code read instead of built-in names:

- Artifacts. A document names the event that its submit sends. A review lists its verdicts, and each verdict names its event and tells if it accepts the work.
- Roles. A workflow binds roles by ID. Each binding lists the workflow artifacts that the role can write and its default artifact.
- Pull request roles. `pullRequestRoles` lists the roles whose sessions can create the pull request. Each ID must be a role of the workflow. An empty list lets the sessions of every role create it.
- States. Each state has its labels, its notification, and its Agent Studio role.
- Launch actions. Each agent step lists the ways to start its role: start modes, prompt template, selection condition, prompt context, target branch choice, and worktree need.
- Signals and automations. An event outcome can raise a signal with its source role. A signal lists the automations that the user can attach to it. An automation names the launch action that Autopilot starts and its start mode. Autopilot continues the latest task session of the automation role. An automation can also name the core pull request launch `pull_request`. Then Autopilot uses the latest task session of any pull request role, and the launch runs as the role of that session. With an empty `pullRequestRoles` list, it uses the latest session of any role. Autopilot skips the pull request launch when no such session exists. The default start mode of the launch action applies when the automation has none. A reuse start that finds no role session in the task worktree starts fresh if the launch action permits it. When `alwaysStartQaReviewsFresh` is on, a role that writes a review artifact starts fresh instead of a reuse or fork, if the launch action permits fresh.
- Action order and priority. Task cards show actions in the declared order. The first matching priority rule selects the primary action.
- Prompts. Every workflow provides the base prompts of `WORKFLOW_PROMPT_IDS` in `packages/contracts`: `workflow.rules`, `workflow.tool_rules`, `workflow.task_context`, `workflow.read_only_rejection`, and `messages.pull_request`. The system prompt of a session is the role instructions, then the first three, in this order. `workflow.read_only_rejection` rejects a mutating tool of a read-only role. `messages.pull_request` is the message of the core pull request launch, and it must keep the `git.targetBranch` placeholder. Each launch action names a prompt in the `messages.` group, which the session gets as its first message or as a message in a running session.
- Merge detection. A state with `mergeDetection` lets the host check the task branch for a merge.

Roles are separate from workflows. The host role catalog holds the built-in roles (`BUILTIN_ROLES` in `packages/workflows/src/builtin/roles/roles.ts`) and will hold custom roles. A catalog role (`agentRoleDefinitionSchema`) owns its label, `odt_*` tools, workspace access, working location, runtime scopes, icon, default panel, and system prompt. A workflow cannot change these. `createTaskWorkflow` merges each binding with its catalog role, and fails for an unknown role ID. The workflow catalog sends each role once. Model defaults and runtime role overrides stay keyed by role ID. The host rejects two workflows that bind one role ID to different catalog roles.

Issue types are fixed: `ISSUE_TYPE_VALUES` in `packages/contracts/src/issue-type-schemas.ts` lists `task`, `feature`, and `bug`. A workflow cannot add an issue type. It lists the issue types that it supports, with their label, description, form guidance, and icon, and its conditions can depend on the issue type. A workflow can support only some issue types.

Each prompt has one owner: a role or a workflow. A role owns its instructions, with the prompt ID `instructions`, for example `build.instructions`. A workflow owns its base prompts and its `messages.` prompts. A prompt ID is unique only within its owner, so two workflows can use one prompt ID with different text. A prompt override is keyed by `promptOverrideKey({ ownerKind, ownerId, promptId })` from `packages/contracts`. A role prompt override applies to the role in every workflow. A workflow prompt override applies to every revision of that workflow.

Host effects are a static set that the host owns: `HOST_EFFECT_IDS` in `packages/contracts/src/workflow-definition-schemas.ts`. An event can declare `effects`, a list of host effect IDs. An event without effects only changes the state. Declare effects only on a task action event. The definition check rejects effects on an agent event, on an artifact save or verdict event, and on a step start event, because the host commits these events inside a session that `worktree.reset` would stop.

- `worktree.reset` stops the sessions of the worktree roles, runs the before worktree removal script, removes their other worktrees and branches, and restores the task worktree to its start point. Then it clears the sessions of the worktree roles, the review artifacts, the pull request link, and the merge record. The event still chooses its target state with its outcomes. The Reset Implementation event of Spec, Plan, Build uses it.

`task_apply_event` (`applyTaskEvent`) is the one path that applies a workflow event by its ID. It accepts the event of an available event action. The host decides the event, runs its effects in order through the host effect registry in `packages/host/src/application/tasks/host-effects/host-effect-registry.ts`, and then commits the event through `commitWorkflowEvent`. When an effect fails, the host commits nothing. A failure after a store write of an effect reports the progress and the changed task. Clients send the event ID; they do not look up an event by its effect.

Close Task and Reset Task are core task actions. A workflow does not declare them, and no event or guard controls them. Close Task (`task_close`) moves any task except a closed one to `closed`. A close of a closed task changes nothing. Reset Task (`task_reset`) moves any task except a closed one to `open`. A reset of an open task keeps the status and still clears the task. The host decides both with `decideCoreTaskAction` in `packages/host/src/application/tasks/support/task-workflow-events.ts`, and commits the state through `transitionTask`. `CLOSE_TASK_ACTION` and `RESET_TASK_ACTION` in `packages/frontend-core/src/tasks/workflow/core-task-actions.ts` give their label, icon, emphasis, and confirmation. Every client shows them from `coreTaskActions(task)` after the workflow actions, and opens their confirmation without the workflow action runner.

Approve is an OpenDucktor feature. A workflow only tells when it is available, with one action of kind `approval` and its `availableWhen` condition. The action has no event. `approvalAvailable(task)` on the task workflow evaluates it. The host commands of the approval (`task_approval_context_get`, `task_direct_merge`, and `task_pull_request_upsert`) fail when the approval is not available for a task that is not closed. Every client runner opens the approval dialog for an `approval` action. The approval outcomes are core decisions, so no workflow event controls them:

- A direct merge without a publish target closes the task.
- A direct merge with a publish target keeps the task state. Its publication (`task_direct_merge_complete`) then closes the task.
- A pull request upsert keeps the task state.
- A merged pull request closes the task. The pull request sync and a manual link of a merged pull request use this rule.
- Close in the approval dialog is the core Close Task.

Each close uses `decideCoreTaskAction("close", task)`, so a close of a closed task changes nothing.

Pull request management is an OpenDucktor feature. The host allows link, detect, unlink, and `odt_set_pull_request` for a task that is not closed. No workflow event controls it. Detection and the upsert read the task branch from the task worktree, so they also need that branch. Link and unlink do not read the branch, because that read needs a Git call. `canUnlinkTaskPullRequest` and `canDetectTaskPullRequest` in `packages/frontend-core/src/tasks/presentation/task-display.ts` give the same rule to the clients.

A recorded local direct merge waits for its publication until the publication closes the task. While it waits, the host rejects every workflow event and Reset Task with an error that tells the user to publish the merge, close the task, or reset the implementation. `commitWorkflowEvent` in `packages/host/src/application/tasks/support/task-workflow-helpers.ts` commits each workflow event transition and runs this check on the locked task row. Workflow artifact submits use the same check, and a role session start checks it before it prepares the worktree. The publication, Close Task, and an event with the `worktree.reset` effect stay allowed, because that effect clears the merge record before the commit.

An event can declare `agent`: the roles that can send it with `odt_apply_workflow_event`, its description, and if it requires a note. An agent event cannot declare `effects`, and the definition check rejects it. Each role must be a role of the workflow, and its catalog role must have the `odt_apply_workflow_event` tool. `agentEvents(roleId)` on the task workflow gives the events of a role, and the system prompt of the role lists them. The host bridge checks the event, the role of the calling session, and a required note. Then `applyAgentEvent` commits the transition through `commitWorkflowEvent`.

A role session start sends the start event of its step after it creates the session. `packages/host/src/application/tasks/support/task-workflow-events.ts` maps denials to typed errors and gives the store the signal and source role of each transition.

Request Changes is a plain event action with a following launch. The feedback form is generic: an event action whose following launch has `context: "human_feedback"` opens it. The session start sends `beforeStartAction: { eventId, note }`. The host accepts it only for a launch with the `human_feedback` context, and commits the event through `applyTaskEvent` before the session starts, so its effects and the merge check apply. The event must be available now. The client and the host check the step of the launch against the task in the state that the event gives, through `taskAfterEvent` on the task workflow. A launch that an available event action starts next also commits that event. When the action has no launch to start, the form commits the event alone with `task_apply_event`.

`createTaskWorkflow` in `packages/workflows/src/task-workflow` gives the host one API for any workflow: task projection, event decisions, roles, artifacts, launch actions, automations, notifications, and prompts. Only `issueType` is a fact. Artifact states come from the task `artifactSummary`, keyed by artifact code. Host code reads the workflow of a stored task with `forTask` and the workflow of a new task with `forNewTask` on the `TaskWorkflowResolver` port. Code that reads many tasks resolves the workflow of each task, and settings cover every workflow of the host. Runtime adapters read the tools and workspace access of a session role through a `WorkflowRolePolicyResolver`, which takes the task and role of the session scope.

Settings follow the workflows of the host. A read adds the notification and Autopilot defaults of each workflow. A write fails for a role, prompt, signal, automation, or notification kind outside them.

`packages/workflows/src/builtin` owns the built-in workflows and roles. `builtin/spec-plan-build` owns the production default definition, `openducktor-spec-plan-build` ("Spec, Plan, Build"), its prompts, and its board layout. `builtin/roles` owns the built-in roles and their system prompts. The definition is the one workflow document: its entities carry optional display fields, such as issue types, state tones, action surfaces and icons, step display rules, and launch order. Injected resolvers can serve several workflows in one workspace. `workflow_catalog_get` returns the validated host inventory and `workspace_workflow_get` returns its explicit shared board order and new-task workflow. All clients join task projections to the exact host definition through the connection-owned Query cache. Missing definitions, invalid references, and incomplete or conflicting shared boards fail with an actionable error. The MCP server names the fixed issue types and the states other than `closed` in the host workflows as a hint; the host validates the workflow of each task.

`createTaskWorkflowResolver` in `packages/host/src/application/tasks/task-workflows.ts` owns host inventory validation, exact revision lookup, and workspace board membership. Task reads and notification projection use this same module. Clients validate received workflow data through their connection-owned queries.

The evaluator returns decisions. The host applies effects and writes to SQLite:

```mermaid
flowchart TD
    A[Definition and explicit input] --> B[Workflow evaluator]
    B --> C[Step and action projection]
    B --> D[Event decision]
    C --> E[Frontend display]
    D --> F[Host effects and task write]
```

A workspace board layout owns only column order and task order. The host resolves each column from the workflows that use its state: the label, title, short label, and tone. The host checks once that every workflow that uses a state ID declares equal metadata. The board covers every workflow state exactly once. Shared IDs combine cards across workflows without combining their actions or roles. State notifications and default Studio roles remain workflow-specific. Tones and icons are closed vocabularies in `packages/contracts`. Each client maps every token to its own icons and theme tokens, and keeps paint, live activity, and platform controls. Human steps show progress and actions without a role tab, composer, model picker, or agent session.

Steps have their own IDs, separate from roles. The required, available, and completed flags of a step describe policy. They do not schedule work. Event guards enforce prerequisites. The built-in derives the `canSkip` flag of the task protocol from `required`.

Task and session records store no workflow identity or revision. Task responses and committed transition snapshots include a computed `{ id, revision }` reference from the same resolved workflow that projects steps and actions. The record schema and SQLite validation exclude these response fields. Durable workflow assignments, immutable revision storage, and upgrade policy remain future work.

Task update events carry `statusChanges` with the previous status, the source role, and the task snapshot at each committed transition. The committed observer also receives the signal of the transition, and Autopilot reads it. After a transaction commits, the SQLite adapter records its local changes in memory for publication through that host's task stream. Committed changes carry the workflow ID and saved Autopilot rules. The local Autopilot observer creates launch attempts and checks their admission before starting them. These attempts stay in memory. Startup and explicit reads do not dispatch them. See [host database access](host-database.md#concurrent-database-access) for process behavior.

Workflow notifications use these committed transitions. A `snapshot_required` refresh can read newer task data before buffered events arrive, so that read cannot define whether an event changed status. Initial snapshots remain silent. Event IDs and transition positions identify repeated delivery of the same change.

For a human action:

1. The user selects an action from `availableActions`.
2. The frontend calls a host method such as `taskApplyEvent`, `taskClose`, or `taskReset`.
3. The shell maps the method to a host command.
4. The host decides the workflow event of the action.
5. The task store writes status, fields, or artifacts.
6. The frontend refreshes tasks and renders the new action list.

For an agent tool:

1. The session calls an `odt_*` tool on the local `openducktor` MCP server.
2. `packages/openducktor-mcp` checks input with `ODT_TOOL_SCHEMAS`.
3. `OdtTaskStore` forwards the call to the host bridge. For an external client, the host maps `workspaceId` to `repoPath`.
4. The host decides the workflow event of the call and writes through the task store.
5. The tool result enters the session stream.
6. The frontend sees the completed mutation tool and refreshes tasks.

Managed and external MCP clients use the same bridge. The host alone owns SQLite. Repository sessions get all `ODT_MCP_TOOL_NAMES` and use runtime approval rules. Task workflow sessions keep their role tool limits. They can call `odt_create_task`, `odt_update_task`, and `odt_search_tasks`, but not `odt_get_workspaces`.

## Generate a pull request

Pull request generation is an OpenDucktor feature. No workflow declares its launch. `PULL_REQUEST_LAUNCH` in `packages/workflows/src/task-workflow/pull-request-launch.ts` defines the core launch `pull_request` (`PULL_REQUEST_LAUNCH_ID` in `packages/contracts`). It continues or forks a session in the task worktree, with `reuse` as the default start mode. It sends the `messages.pull_request` prompt of the workflow with the task target branch.

1. The approval dialog, the Agent Studio quick action, and the mobile quick action start the core launch. They show it while the task is not closed and its approval is available (`pullRequestLaunchAvailable(task)`), and while the Git provider supports pull requests.
2. The user selects a session of a pull request role. With an empty `pullRequestRoles` list, every task session can create the pull request. The launch runs as the role of the selected session. The manual launch request names that role, and the host checks that the source session has it.
3. The agent uses provider Git or GitHub tools to create or update the pull request.
4. The agent calls `odt_set_pull_request`.
5. The host resolves the configured provider and pull request number, then stores the canonical metadata.

The page does not parse chat text to create a pull request.

## Sources of truth

| Concern | Source | Owner |
|---|---|---|
| Formats of status, role, and start mode, and the fixed issue types | `packages/contracts/src/task-schemas.ts`, `packages/contracts/src/issue-type-schemas.ts`, `packages/contracts/src/agent-workflow-schemas.ts` | Contracts |
| Built-in states, roles, and actions | `packages/workflows/src/builtin/spec-plan-build/ids.ts`, `packages/workflows/src/builtin/roles/ids.ts` | Workflows |
| ODT tool names and schemas | `packages/contracts/src/odt-tool-names.ts`, `packages/contracts/src/odt-mcp-schemas.ts` | Contracts |
| Role tool list | The host role catalog | Workflows |
| Generic workflow definitions, display vocabularies, and decisions | `packages/contracts/src/workflow-*-schemas.ts` | Contracts |
| Workflow evaluation and built-in rules | `packages/workflows/src/*` | Workflows |
| Workflow execution and typed failures | `packages/host/src/domain/task/*`, `packages/host/src/application/tasks/*` | Host |
| Task state | SQLite `tasks.status` | Host SQLite adapter |
| Database identity | `<config-root>/database.sqlite` | Host SQLite infrastructure |
| Artifacts and durable session records | SQLite task-store rows | Host task services |
| Live session state and reply routing | `packages/host/src/application/agent-sessions/*`, `packages/host/src/adapters/agent-sessions/*` | Host runtime adapter |
| Renderer session view | `packages/frontend-core/src/sessions/agent-orchestrator/session-read-model/*` | Client projection |
| Transcript history | Selected runtime history adapter | Runtime adapter |
| Host execution errors | Effect and tagged errors in `packages/host/src` | Host |
| Client server-read cache | Query modules under `packages/frontend-core/src/queries` | Frontend core |

## Replaceable boundaries

- Workflow definitions and `createWorkflow` in `packages/workflows`.
- Agent engine ports in `packages/core/src/ports/agent-engine.ts`.
- Live-session port in `packages/host/src/ports/agent-session-live-adapter-port.ts`.
- Native runtime code in `packages/adapters-opencode-sdk`, `packages/adapters-codex-app-server`, and `packages/host/src/adapters/claude`.
- SQLite `TaskStorePort` code under `packages/host/src/adapters/sqlite`.

## Cross-layer change order

1. Change a shared data shape in `packages/contracts` first.
2. Change ODT names or workflow schemas in contracts, workflow policy, adapters, host, MCP, and UI together.
3. Change public MCP schemas and package docs together.
4. Change workflow rules before their callers and documentation.
5. Keep workflow rules in `packages/workflows`. Host services own task writes and database paths. Shells map transport.
