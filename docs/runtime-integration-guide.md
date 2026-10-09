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
| `RuntimeRoute` | Address of a running runtime | Runtime process |
| Runtime connection | Native client input built from a resolved route | One operation |
| `AgentSessionRecord` | Durable data used to reopen a session | Durable |
| Live-session adapter | Normalized state for running sessions | Runtime process |

`RuntimeDescriptor` contains `kind`, `label`, `description`, `readOnlyRoleBlockedTools`, `workflowToolAliasesByCanonical`, and `capabilities`. Shared code reads the descriptor instead of testing the runtime kind.

`RuntimeInstanceSummary` contains the runtime kind and ID, route, start time, and descriptor. It contains no repository or working directory, because one instance serves every workspace. Keep it at registry and adapter boundaries. A replacement instance receives a new runtime ID.

`RuntimeRoute` can be `local_http`, `stdio`, or `host_service`. A `local_http` route must use the loopback host `localhost`, `127.0.0.1`, or `::1`. Never persist a route. `RuntimeTransport` carries request-scoped `local_http` and `stdio` connections. A host service can resolve inside its host adapter without a new public transport type.

`AgentSessionRecord` stores the external session ID, role, start time, optional `lastActivityAt`, runtime kind, working directory, and selected model. It does not store an endpoint, route, transport, pending request, event buffer, or native reply ID.

The live-session adapter owns the normalized snapshot, transcript, current context use, pending approvals and questions, child links, and native reply IDs. Keep this state out of SQLite and renderer caches.

Every session operation uses the stored runtime kind, workspace repository, and working directory. If the shared runtime of that kind is not ready, fail the operation with its state and next action. Do not use another runtime kind or the repository default runtime as a fallback.

## Shared runtime

One host runs at most one runtime of each enabled kind. All workspaces and task worktrees share it. The host starts it at host startup, and restarts, replaces, or stops it. An adapter or the frontend never starts or stops a runtime.

A new runtime kind plugs in through one `RuntimeDriver` from `@openducktor/runtime-orchestration` ([ADR 0010](adr/0010-own-runtime-orchestration-in-a-platform-independent-package.md)). Add the driver in `packages/host/src/adapters/runtimes/runtime-drivers.ts`. The orchestrator does not change.

| Driver part | Rule |
|---|---|
| `start` | Start one process or service for all workspaces. Start it in the user home directory, and put no workspace ID or repository in its configuration. Call `ownCleanup` as soon as the first resource exists, and do not clean up a failed start yourself. Fail with the cause and next action. Do not retry or start another executable. |
| `onRuntimeExit` | Report a process exit or a fatal transport failure after the start. |
| `onRuntimeCleanupFailed` | Report a cleanup failure after a reported exit. |
| `stop` on the handle | Stop the resource and release every live session of it, in all workspaces. Settle each transcript and reject pending input. Saved session records and native history stay available. |
| `probeVersion` | Read the executable version. A missing version does not fail a start. |
| `validateExecutable` | Check an executable before a settings change stops or starts a runtime. |
| `stopSession`, `probeSession` | Act on the exact session. |

Each session operation sends the directory of its session to the shared runtime. Do not depend on the directory of one workspace.

### Workspace binding of OpenDucktor tools

A shared process must not give every workspace the same workspace ID. Bind the managed OpenDucktor MCP server to the workspace of each session, and keep `ODT_FORBID_WORKSPACE_ID_INPUT=true`. A failed binding fails the operation that needs it, with its cause.

| Runtime | Binding |
|---|---|
| OpenCode | Before a session uses workflow tools, `mcp.add` for the session directory with the bridge environment of its workspace. A directory keeps one binding, and a conflicting workspace fails the operation. |
| Codex | Each `thread/start`, `thread/resume`, and `thread/fork` request sends `mcp_servers.openducktor.*` overrides with the bridge environment of the session workspace. |
| Claude | Each session resolves the bridge from its own repository. |

## Ownership

| Owner | Owns | Does not own |
|---|---|---|
| Shared contracts | Descriptors, routes, session identity, prompt parts, events, snapshots, and history items | SDK types and native parsing |
| Native adapter | Client setup, native config, requests, events, history, catalogs, input, errors, and cleanup | Shared orchestration and renderer state |
| Live-session adapter | Ordered controls and events, live snapshots, context, pending input, and child sessions | A second native protocol |
| Host | Runtime lifecycle, route registration, service wiring, commands, and lifecycle guards | Guessed routes |
| Frontend | Capability-based UI, normalized transcript, queries, and operation errors | Native payloads |

Put shared data in `packages/contracts` only when it is an OpenDucktor concept. Keep SDK options and protocol details in the native adapter.

Create and subscribe the live-session adapter before the runtime can send events. Use TanStack Query for stable frontend reads such as history and catalogs. Keep live transcript state in the live-session store.

OpenCode creation, fork, and reattach prepare a conversation without starting agent work. Keep control summaries in sync with the known turn state. Prompt submission reports running activity while OpenCode starts the turn. Native turn events then confirm running or idle activity. Registration must not emit a synthetic `session_started` activity event.

Restoring an idle Claude session must not publish new activity. Publish startup activity for a new session, a fork, or an interrupted turn that the runtime continues.

Provide an `AgentRuntimeQueryAdapterPort` with each live-session adapter. Reuse the native controller that owns its session state. Route frontend reads through `HostClient`. Check that queries do not resume sessions or change live state. Test reads during live updates and runtime replacement.

The host saves `lastActivityAt` in task and workspace session records as epoch milliseconds. The session list reads that field through its existing record queries. Older task records use `startedAt`; older workspace records use `createdAt`. Never read native metadata or load a transcript to get a navigation date.

`agent-session-activity-persistence.ts` saves dates from the ordered live stream at message and turn boundaries. New pending input uses the host clock because request snapshots have no event timestamp. Child activity updates its saved root. Saves use the full session identity and never move the date backwards. Task activity saves do not change the task's edit time. Committed records reach the frontend through the existing live channel.

Restore baselines, repeated status reports, title and model edits, streamed text, and idle connection cleanup do not change activity dates. Claude writes native bookkeeping records on restore and shutdown; do not use those records as activity. A context usage read must not persist a resumed Claude session.

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

When the adapter cannot read the current status of a session, it reports a session-scoped `fault` with `statusUnavailable`. If it keeps the last snapshot, it also sets `statusUnavailableReason` on that snapshot. Keep the reason through context, title, and other updates that do not read the status. Clear it with the next status read or live status event. That change makes the snapshot differ, so an unchanged successful read still publishes the recovery. Other session faults keep the live status.

A status read can overlap other updates. When a live status event, a control result that sets the status, or another successful read confirms the status during the read, ignore the status of the read. When only context, title, or pending input changes during the read, apply only the status of the read and keep the newer data. A failed read does not confirm a status, so a successful read that overlaps it still clears the failure.

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

Claude tool availability uses optional `toolAvailability` maps in the default and role policy fields. A missing default map disables `Artifact`, `ArtifactComments`, and `ArtifactData`. An explicit map replaces these initial choices; omitted keys and `true` values add no exclusion. A missing role map inherits defaults, an explicit role map replaces them, and an empty role map enables all tools by preference. Removing the role's field restores inheritance without changing its other policy fields. These maps use config version `4`; old data remains readable, but older app versions can reject the new field.

`agent_runtime_claude_tool_catalog` reads the exact ready Claude service without a workspace. The adapter initializes a short-lived, non-persistent SDK query in the user home directory with the native default model. It checks that Claude advertises the built-in `/context` command, submits that local command, and reads the public `system/init.tools` list. This starts no model prompt and adds no OpenDucktor MCP binding. The list includes deferred built-in tools. The adapter excludes MCP names and closes the query after success, failure, or cancellation. Missing metadata or a missing built-in command fails with an update action. It does not become an empty catalog or block session startup.

The [SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript#sdkcontrolgetcontextusageresponse) states that Claude leaves `systemTools` and `deferredBuiltinTools` unset. They cannot supply this catalog. The SDK's init list still calls the `Agent` tool `Task` for compatibility. The catalog, effective settings, exclusions, and authorization use the current `Agent` name. If saved settings contain both names, an exclusion wins. Reading these settings does not rewrite them. Editing the Agent choice saves one current-name entry.

The Claude settings editor retains Artifact and saved names when they are absent from a successful catalog. A failed read retains the draft and shows a retry action. Catalog availability can differ by provider, model, platform, and project policy. The editor and adapter share known native limits through `CLAUDE_RESERVED_TOOL_LIMITS`. A saved reserved tool such as `EndConversation` shows a reason and no disable switch even when catalog metadata is absent, loading, or failed. The editor can clear a saved exclusion for a reserved tool in each of these states. The adapter still enforces the limit at session startup.

Tool availability uses the same default and role layout as the other runtime settings. Defaults stay visible. The Role overrides switch shows each workflow role with an Inherited or Use this list choice. Use this list copies the current default choices before edits. Each list has its own search. Inherited removes only that role's tool map, and turning Role overrides off clears all tool maps while keeping other role settings. An explicit empty map remains a role override with all tools enabled by preference.

Native feature access is separate from OpenDucktor's exclusions. [Claude's Artifact availability contract](https://code.claude.com/docs/en/artifacts#availability) states that Artifact tools are off by default in SDK sessions and also depend on account, provider, and organization policy. Enabling an Artifact preference removes its OpenDucktor exclusion; it does not activate the native feature. Claude's `/context` output groups built-in tools into token totals rather than listing each name. Check the native init tool list when testing individual definitions, and compare matching session contexts when using these totals.

Saved tool choices apply to fresh and forked sessions through a fixed native exclusion set. The adapter combines exact whole-tool `disallowedTools` entries with mandatory role exclusions and keeps the native tool preset. Root and child authorization deny excluded tools before approvals or questions. Denial events retain the native reason and explain the session preference. Enabling a preference grants no permission. Existing, resumed, imported, and continued sessions receive no new tool map, and tool-choice saves do not restart the shared runtime.

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

`inspectSession` must check the exact source and keep its original ID, directory, and available settings. It returns a `RuntimeSessionImportSource`. The host saves the workspace association before it calls `attach` on that source. The adapter must not retain a live resource before the save. A failed attach must leave the saved association available for retry.

Only an explicit import can claim a native root. The host checks repository or registered-worktree scope and existing task or workspace ownership. The adapter must not create, fork, or move the source conversation. It must report native access failures instead of substituting another session.

## Code map

| Part | Path |
|---|---|
| Schemas | `packages/contracts/src/agent-runtime-schemas.ts`, `packages/contracts/src/agent-engine-schemas.ts` |
| Live-session port | `packages/host/src/ports/agent-session-live-adapter-port.ts` |
| Live-session adapters | `packages/host/src/adapters/agent-sessions` |
| Runtime orchestration | `packages/runtime-orchestration/src` |
| Runtime drivers | `packages/host/src/adapters/runtimes/runtime-drivers.ts` |
| Native adapters | `packages/adapters-opencode-sdk/src`, `packages/adapters-codex-app-server/src`, `packages/host/src/adapters/claude` |
