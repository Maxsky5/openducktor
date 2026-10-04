# Runtime integration guide

Read this guide before you add a runtime or change runtime capabilities, sessions, history, approvals, prompts, or catalogs.

| Runtime | Route | Native form |
|---|---|---|
| OpenCode, `opencode` | `local_http` | External HTTP runtime |
| Codex, `codex` | `stdio` | Host-managed app server |
| Claude, `claude` | `host_service` | Host-managed SDK service |

Each adapter keeps its native protocol inside the adapter and exposes OpenDucktor contracts outside it.

## Runtime model

| Concept | Meaning | Lifetime |
|---|---|---|
| `RuntimeDescriptor` | Static identity, policy, and capabilities for one runtime kind | App |
| `RuntimeInstanceSummary` | One running shared runtime of a kind | Runtime process |
| `HostRuntimeStatus` | Lifecycle state of the shared runtime of a kind | Host |
| `RuntimeRoute` | Address of a running runtime | Runtime process |
| Runtime connection | Native client input built from a resolved route | One operation |
| `AgentSessionRecord` | Durable data used to reopen a session | Durable |
| Live-session adapter | Normalized state for running sessions | Runtime process |

`RuntimeDescriptor` contains `kind`, `label`, `description`, `readOnlyRoleBlockedTools`, `workflowToolAliasesByCanonical`, and `capabilities`. Shared code reads the descriptor instead of testing the runtime kind.

`RuntimeInstanceSummary` contains the runtime kind and ID, route, start time, and descriptor. It contains no repository or working directory, because one instance serves every workspace. Keep it at registry and adapter boundaries. A replacement instance receives a new runtime ID.

`RuntimeRoute` can be `local_http`, `stdio`, or `host_service`. A `local_http` route must use the loopback host `localhost`, `127.0.0.1`, or `::1`. Never persist a route. `RuntimeTransport` carries request-scoped `local_http` and `stdio` connections. A host service can resolve inside its host adapter without a new public transport type.

`AgentSessionRecord` stores only the external session ID, role, start time, runtime kind, working directory, and selected model. It does not store an endpoint, route, transport, pending request, event buffer, or native reply ID.

The live-session adapter owns the normalized snapshot, transcript, current context use, pending approvals and questions, child links, and native reply IDs. Keep this state out of SQLite and renderer caches.

Every session operation uses the stored runtime kind, workspace repository, and working directory. If the shared runtime of that kind is not ready, fail the operation with its state and next action. Do not use another runtime kind or the repository default runtime as a fallback.

## Host runtime lifecycle

One OpenDucktor host runs at most one managed runtime of each enabled kind. All workspaces and task worktrees of that host share it. OpenCode runs one `opencode serve` process. Codex runs one `codex app-server` process. Claude runs one logical host service, and each live Claude session keeps its own CLI process.

| Rule | Detail |
|---|---|
| Startup | Host initialization reads the saved `agentRuntimes` settings and starts each enabled kind in the background. It does not wait for a frontend, a workspace, or a session. A failed start records an error with the kind, cause, and next action. It does not retry or start another executable. The host log records each state change of a runtime: start, ready with executable and version, restart, stop, and failure. |
| Launch | OpenCode and Codex start in the user home directory. Process configuration contains no workspace ID. Each operation sends the directory of its session. |
| Ownership | `packages/host/src/adapters/runtimes/runtime-registry.ts` owns one slot for each kind. The slot holds the resource, its generation, the lifecycle state, and the last failure. |
| Admission | `runtime-admission.ts` admits session controls only while the slot is ready. A lifecycle action closes admission and waits up to 10 seconds for admitted controls before it stops the resource. It then cancels the remaining controls, and each caller gets an error with the next action. |
| Startup cleanup | A starter gives the cleanup of each resource that it acquires to the host with `ownCleanup`. A failed start does not clean up in the starter. The registry runs the owned cleanup once, reports a failure once, and retries a failed cleanup before the next stop, restart, or shutdown. |
| Status | The host publishes `HostRuntimeStatus` on the `openducktor://runtime-changed` channel. The channel has no repository scope. `runtime_status` returns the current snapshot. |
| Restart | `runtime_restart_impact` lists the live sessions of the kind in every workspace and issues a confirmation. A live session is one with work in progress or pending input, or one that a session control of this runtime generation served, with its child sessions. An idle session that the runtime only restored from saved history is history, so the review does not list it. `runtime_restart` rechecks that impact, stops the old resource, then starts a replacement with the saved executable. New work after the review returns `impact_changed`. |
| Review updates | When a live session starts, ends, or changes a field that a review shows (title, activity, execution episode, parent, or pending input), the host publishes `runtime_impact_changed` with its runtime kinds on `openducktor://runtime-changed`. Transcript and context updates publish nothing. An open restart or settings review reads its impact again after this event, after a `runtime_changed` event of a reviewed kind, and after the event stream reconnects. A review cannot confirm while a read runs, after a failed read, or while live updates are unavailable. In the browser runner, a subscriber that joins during a connection failure gets the current warning before its subscription is ready. |
| Settings | A saved enable starts the kind. A saved disable stops it. A saved path change of an enabled kind replaces it. A save that stops live sessions needs a confirmation from `workspace_preview_settings_snapshot_runtime`. Before the write, the host validates each executable that the save starts. An invalid executable fails the save, and the host does not write settings or stop a runtime. The host writes settings before it applies runtime changes, and reports each kind separately. |
| Restore | A new runtime generation restores the saved session roots of each repository that a renderer views. A repository that cannot be restored gets a `fault` event with the cause. The runtime still becomes ready for the other repositories. |
| Loss | A stop, crash, restart, or disable releases every session of that runtime in all workspaces. A crash makes the runtime unavailable before its cleanup runs. A starter reports a failed cleanup with `onRuntimeCleanupFailed`, and the registry adds its cause to the crash error of that generation. Pending input fails. Saved session records and native history stay available. |
| Shutdown | Shutdown closes admission, interrupts pending starts, and waits for admitted controls with the same 10-second limit. Shutdown then stops every resource. A released Claude service rejects a control that reaches it late. |

The frontend never starts a runtime. Session reads and controls require the exact kind to be ready.

### Workspace binding of OpenDucktor tools

A shared process must not give every workspace the same workspace ID. The host binds the managed OpenDucktor MCP server to the workspace of each session.

| Runtime | Binding |
|---|---|
| OpenCode | Before a session uses workflow tools, the adapter calls `mcp.add` for the exact session directory with the explicit bridge environment of that workspace. An import attachment and an approval or question reply also need this binding first. A failed attachment binding leaves the root out, and the saved association reports it as `openError`. A directory keeps one binding. A conflicting workspace fails the operation. `server.instance.disposed` and runtime release clear the binding. |
| Codex | Each `thread/start`, `thread/resume`, and `thread/fork` request sends `mcp_servers.openducktor.*` overrides with the explicit bridge environment of the session workspace. |
| Claude | Each session resolves the bridge from its own repository. |

Every binding keeps `ODT_FORBID_WORKSPACE_ID_INPUT=true`.

A failed binding fails the operation that needs it, and the error gives the cause. Diagnostics do not list runtime MCP bindings.

## Ownership

| Owner | Owns | Does not own |
|---|---|---|
| Shared contracts | Descriptors, routes, session identity, prompt parts, events, snapshots, and history items | SDK types and native parsing |
| Native adapter | Client setup, native config, requests, events, history, catalogs, input, errors, and cleanup | Shared orchestration and renderer state |
| Live-session adapter | Ordered controls and events, live snapshots, context, pending input, and child sessions | A second native protocol |
| Host | Startup, shared runtime slots, admission, route registration, service wiring, commands, and lifecycle guards | Guessed routes |
| Frontend | Capability-based UI, normalized transcript, queries, and operation errors | Native payloads |

Put shared data in `packages/contracts` only when it is an OpenDucktor concept. Keep SDK options and protocol details in the native adapter.

Create and subscribe the live-session adapter before the runtime can send events. Use TanStack Query for stable frontend reads such as history and catalogs. Keep live transcript state in the live-session store.

Provide an `AgentRuntimeQueryAdapterPort` with each live-session adapter. Reuse the native controller that owns its session state. Route frontend reads through `HostClient`. Check that queries do not resume sessions or change live state. Test reads during live updates and runtime replacement.

Before you map a feature, inspect official SDK types, protocol docs, or runtime source. Check startup, config, auth, models, sessions, activity, history, tools, approvals, questions, context, catalogs, and optional features. Keep a capability off when the public runtime contract lacks the needed data.

## Capability contract

Each enabled `RuntimeDescriptor.capabilities` field needs a working adapter path and matching UI.

### Provisioning and workflow

| Field | Meaning |
|---|---|
| `provisioningMode` | `host_managed` or `external` |
| `workflow.supportsOdtWorkflowTools` | Can run canonical ODT tools |
| `workflow.supportedScopes` | Can run `workspace`, `task`, or `build` sessions |

### Session lifecycle

| Field | Meaning |
|---|---|
| `sessionLifecycle.supportedStartModes` | Supports `fresh`, `reuse`, or `fork` |
| `sessionLifecycle.supportsSessionFork` | Can fork a session |
| `sessionLifecycle.forkTargets` | Can fork at `session`, `message`, or `item` |
| `sessionLifecycle.supportsListLiveSessions` | Can return live state for sessions that OpenDucktor registered |
| `sessionLifecycle.supportsQueuedUserMessages` | Can keep a queued user message visible while busy |
| `sessionLifecycle.supportsPendingInputSnapshots` | Can keep unresolved input in snapshots |
| `sessionLifecycle.supportsInterruptedTurnResume` | Can continue an unfinished turn with no user message |

### History

| Field | Meaning |
|---|---|
| `history.loadable` | A supported API can load a stored session |
| `history.fidelity` | `none`, `message`, or `item` detail |
| `history.replay` | `none`, `snapshot`, `turn_items`, or `event_replay` rebuild |
| `history.stableItemIds` | Item IDs stay stable across reads |
| `history.stableItemOrder` | Item order stays stable across reads |
| `history.exposesCompletionState` | History marks running and finished items |
| `history.limitations` | Native limits that callers must know |

### Approvals

| Field | Meaning |
|---|---|
| `approvals.supportedRequestTypes` | `command_execution`, `file_change`, `permission_grant`, or `runtime_tool` |
| `approvals.supportedReplyOutcomes` | `approve_once`, `approve_turn`, `approve_session`, `approve_always`, or `reject` |
| `approvals.omittedPermissionBehavior` | `deny` or `requires_explicit_response` |
| `approvals.pendingVisibility` | Pending input appears in `live_snapshot`, `history`, or both |
| `approvals.canClassifyMutatingRequests` | Adapter can identify a request that can change state |
| `approvals.readOnlyAutoRejectSafe` | Adapter can reject a mutating request for a read-only role |

### Questions

| Field | Meaning |
|---|---|
| `structuredInput.supportsQuestions` | Runtime can ask a structured question |
| `structuredInput.supportsMultipleQuestions` | One request can contain more than one question |
| `structuredInput.supportedAnswerModes` | Supports `free_text`, `single_select`, or `multi_select` |
| `structuredInput.supportsRequiredQuestions` | A question can require an answer |
| `structuredInput.supportsDefaultValues` | A question can have a default |
| `structuredInput.supportsSecretInput` | Input can be hidden |
| `structuredInput.supportsCustomAnswers` | User can answer outside listed choices |
| `structuredInput.supportsQuestionResolution` | Adapter can resolve a pending question |
| `structuredInput.pendingVisibility` | Pending questions appear in `live_snapshot`, `history`, or both |

### Prompt input

| Field | Meaning |
|---|---|
| `promptInput.supportedParts` | Typed parts such as `text`, `slash_command`, `file_reference`, `folder_reference`, `skill_mention`, `subagent_reference`, `app_mention`, `plugin_mention`, or `runtime_specific` |
| `promptInput.supportsAttachments` | Adapter can encode a file attachment |
| `promptInput.supportsSlashCommands` | Runtime lists and runs slash commands |
| `promptInput.supportsFileSearch` | Composer can search native file and folder references |
| `promptInput.supportsSkillReferences` | Composer can send a typed skill reference |
| `promptInput.supportsSubagentReferences` | Composer can send a typed subagent reference |

#### Attachments

`promptInput.supportsAttachments` says that the adapter can encode an attachment. `AgentModelDescriptor.attachmentSupport` says which `image`, `audio`, `video`, or `pdf` types the model accepts. A type can also have a MIME allowlist.

If `attachmentSupport` is absent, the runtime did not provide model attachment data. The composer rejects an unsupported kind or MIME type.

An attachment part has an ID, local path, name, kind, and optional MIME type. In a browser, the frontend asks the host to stage the `File`, then sends the staged path.

Encode each attachment in the runtime's native prompt form. Keep the staged path in the encoded part so a later history read can restore the local preview.

A prompt cannot mix a slash command and attachments because a slash command uses a separate native call.

### Optional features

| Field | Meaning |
|---|---|
| `optionalSurfaces.supportsProfiles` | Runtime lists model or agent profiles |
| `optionalSurfaces.supportsVariants` | Runtime lists model variants such as reasoning effort |
| `optionalSurfaces.supportsTodos` | Native tasks map to OpenDucktor todos |
| `optionalSurfaces.supportsDiff` | Runtime provides session or workspace diff |
| `optionalSurfaces.supportsFileStatus` | Runtime provides file status |
| `optionalSurfaces.supportsMcpStatus` | Runtime provides MCP connection state |
| `optionalSurfaces.supportsImageGeneration` | OpenDucktor can display native generated images |
| `optionalSurfaces.supportsSubagents` | OpenDucktor can observe native subagent work |
| `optionalSurfaces.supportedSubagentExecutionModes` | Supports `foreground` or `background` subagents |

## Descriptor rules

- Every runtime supports `fresh` and `text`.
- Fork mode, fork support, and fork targets agree.
- Item history requires a loadable API, stable IDs, stable order, and completion state.
- A runtime without loadable history uses `none` for fidelity and replay.
- Approval support includes `reject` and at least one approval result.
- Read-only auto-reject requires mutation classification and rejection support.
- A runtime without questions leaves all question detail empty.
- A runtime with questions has an answer mode and can resolve the question.
- Live pending-input visibility requires pending-input snapshots.
- Slash command, file search, skill, and subagent flags agree with `supportedParts`.
- A runtime without subagents has no subagent execution modes.

`runtimeCapabilityKeyValues` defines product gates.

| Policy | Capability keys |
|---|---|
| Required | ODT workflow tools, read-only auto-reject, start modes, and prompt parts |
| Optional | Queued messages, history, approvals, questions, attachments, slash commands, file search, skill and subagent references, profiles, variants, todos, diff, file status, MCP status, generated images, and subagents |

Capability classes record why a gate exists.

| Class | Use |
|---|---|
| `baseline` | Start modes and prompt parts |
| `workflow` | ODT tools, approvals, read-only roles, and questions |
| `role_scoped` | Workflow scopes |
| `launch_scoped` | Fork and history |
| `optional_enhancement` | All optional product features |

Workflow aliases and blocked tools are `workflow`. Fork targets and history details are `launch_scoped`. Approval and question details are `workflow`.

| Role | Required scopes |
|---|---|
| Spec | `workspace` |
| Planner | `workspace` |
| Builder | `build`, `workspace` |
| QA | `task` |

Accept a runtime definition only when its schema is valid, it can run workflow tools safely, all role scopes exist, and each launch action has a supported mode. A default runtime must support every role.

## Shared behavior

### Session state

OpenDucktor owns root-session admission. Start, resume, and fork controls register returned runtime metadata before a session enters the live-state list. A runtime adapter cannot scan a native session list to add roots. A runtime event can add a descendant only when OpenDucktor registered its parent.

On reload, the host reads exact root references from durable task session records. A live-state adapter reads only those roots and their verified descendants through exact native APIs. It cannot list native sessions to claim new live roots. The explicit import flow below is a separate discovery path.

A fresh or forked session starts with a running lease. An old native idle event cannot mark it idle before the first turn settles.

Resume keeps the current running turn, approval, or question until a newer native event replaces it. One ordered coordinator applies control results and native events.

The persistence observer does not call the runtime inside the publication or lock scopes. A runtime-visible follow-up, such as a session rename, runs after those scopes release.

Renderer attachment is atomic. Its first envelope has the current snapshot. Later changes use the same ordered channel. Separate snapshot and subscribe calls have a race.

Map native completion, stream end, runtime failure, stop, and release as different events. Final release removes the session tree and rejects unresolved requests.

Current context use is live state, not total result use. If a direct read races stream events, queued events set the baseline and an event processed during the read wins.

### Transcript and history

Live and loaded items use the same identity, role, order, time, completion, error, tool name, display parts, prompt references, todos, subagents, and compaction meaning.

Feed thin native live and history readers into one projector. Use the public SDK or API for history. A history read does not resume the session, consume live events, discover pending input, or change live state.

Use native fields to classify tool-result wrappers, synthetic messages, queue operations, command output, compaction, and child delivery. Do not classify them by displayed text or a regular expression.

Use stable native IDs when present. Deduplicate by ID and lifecycle, not message text. Keep tool proposal, queue, execution, progress, and completion separate. Measure duration from native execution start. If history omits that point, omit duration.

Keep the original tool ID and reason for success, failure, and denial. Read file edits from structured results or supported hooks. Do not infer a diff from tool input or private transcripts.

Keep prompt parts typed until the adapter encodes them. History must rebuild the same command, skill, file, attachment, and subagent parts as the live stream.

### Configuration and catalogs

Use supported SDK options to inherit native auth, providers, settings, instructions, models, skills, commands, permissions, sandbox rules, and MCP servers. Do not create a separate runtime home, edit user settings, or parse private config files.

OpenDucktor can add session workflow tools, MCP servers, hooks, or instructions. Keep unrelated native config.

Read the effective model catalog from the runtime so proxy and third-party providers remain present. Use native metadata to separate commands, bundled workflows, user skills, and model skills. Keep a bounded classification rule in one runtime module only when the API has no type field.

For a repository that is not yet a workspace, `agent_runtime_preview_models` reads Claude, Codex, or OpenCode models through a short-lived native session or process. The host checks the Git path, does not connect the OpenDucktor MCP bridge, and closes the session or process after the read. Keep this preview out of the host runtime registry and use a separate frontend query key.

Keep names that the runtime accepts. A bad catalog entry fails that catalog request and names the entry. It does not block history or session reads.

### Workflow prompts

The built-in prompt templates live in [agent-system-prompts.ts](../packages/core/src/services/agent-system-prompts.ts). System prompts define role responsibilities, workflow rules, and completion. Kickoff prompts request the current task's artifact. Keep detailed role and writing instructions in the templates.

For each changed template, set `builtinVersion` to the target branch's version plus one. Increment it only once per PR, even when later commits revise the prompt.

Existing custom overrides remain active. Users must review, update, or disable old overrides themselves. The app does not display a version-mismatch warning. A new built-in version does not replace custom text.

### Permissions and pending input

Shared role policy lists canonical `odt_*` tools. The descriptor maps them to native aliases and lists native tools blocked for read-only roles.

Inherit native permissions and sandbox settings. Add session hooks through SDK options. Let unclassified tools use the native approval path. Shared code does not edit user settings or parse shell commands.

Do not block Bash only because a role is read-only. Spec, Planner, and QA need it for search and checks.

OpenDucktor request IDs are opaque handles. Keep native reply IDs inside the adapter. A child owns its approvals and questions. The parent can show that the child needs input, but the child transcript must also show and resolve it.

### Optional feature rules

| Feature | Rule |
|---|---|
| Todos | Live events and history build the same todo list and tool name. |
| Generated images | Map native items to `image_generation` in live events and history. Keep generation outcome separate from preview availability. |
| Subagents | Parent and child keep the description, mode, ID, transcript, pending input, and final state. |
| Queued messages | One user-message ID keeps queued state live and in history. |
| Compaction | Map requested, started, completed, and failed states without showing synthetic control messages. |

## Import existing runtime sessions

Implement `RuntimeSessionImportPort` to scan existing root conversations in bounded batches. Keep native cursors inside the adapter. Scanning must not read a transcript, send a prompt, or add a session to live state.

`inspectSession` must check the exact source and keep its original ID, directory, and available settings. It returns a `RuntimeSessionImportSource`. The host runs the inspection, the save, and the attachment as one admitted control, so a lifecycle action waits for the import or cancels it. The host saves the workspace association before it calls `attach` on that source. The adapter must not retain a live resource before the save. A failed attach must leave the saved association available for retry.

Only an explicit import can claim a native root. The host checks repository or registered-worktree scope and existing task or workspace ownership. A shared runtime can list conversations of many repositories, so the host filters every scan result. The adapter must not create, fork, or move the source conversation. It must report native access failures instead of substituting another session.

An import names its `catalogRequestId`. The host imports only a candidate from a live catalog of the same workspace, kind, and runtime generation. A runtime replacement or loss invalidates the catalog, and the user must reload the list.

## Code map

| Part | Path |
|---|---|
| Schemas | `packages/contracts/src/agent-runtime-schemas.ts`, `packages/contracts/src/agent-engine-schemas.ts` |
| Live-session port | `packages/host/src/ports/agent-session-live-adapter-port.ts` |
| Live-session adapters | `packages/host/src/adapters/agent-sessions` |
| Runtime registry | `packages/host/src/adapters/runtimes/runtime-registry.ts` |
| Runtime lifecycle service | `packages/host/src/application/runtimes/host-runtime-service.ts` |
| Native adapters | `packages/adapters-opencode-sdk/src`, `packages/adapters-codex-app-server/src`, `packages/host/src/adapters/claude` |
