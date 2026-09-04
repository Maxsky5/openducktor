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
| `RuntimeInstanceSummary` | One running repository runtime | Runtime process |
| `RuntimeRoute` | Address of a running runtime | Runtime process |
| Runtime connection | Native client input built from a resolved route | One operation |
| `AgentSessionRecord` | Durable data used to reopen a session | Durable |
| Live-session adapter | Normalized state for running sessions | Runtime process |

`RuntimeDescriptor` contains `kind`, `label`, `description`, `readOnlyRoleBlockedTools`, `workflowToolAliasesByCanonical`, and `capabilities`. Shared code reads the descriptor instead of testing the runtime kind.

`RuntimeInstanceSummary` contains the runtime kind and ID, repository, optional task, role, working directory, route, start time, and descriptor. Keep it at registry and adapter boundaries.

`RuntimeRoute` can be `local_http`, `stdio`, or `host_service`. A `local_http` route must use the loopback host `localhost`, `127.0.0.1`, or `::1`. Never persist a route. `RuntimeTransport` carries request-scoped `local_http` and `stdio` connections. A host service can resolve inside its host adapter without a new public transport type.

`AgentSessionRecord` stores only the external session ID, role, start time, runtime kind, working directory, and selected model. It does not store an endpoint, route, transport, pending request, event buffer, or native reply ID.

The live-session adapter owns the normalized snapshot, transcript, current context use, pending approvals and questions, child links, and native reply IDs. Keep this state out of SQLite and renderer caches.

Every session operation uses the stored runtime kind and working directory. If that runtime is unavailable, fail the operation. Do not use the repository default runtime as a fallback.

## Ownership

| Owner | Owns | Does not own |
|---|---|---|
| Shared contracts | Descriptors, routes, session identity, prompt parts, events, snapshots, and history items | SDK types and native parsing |
| Native adapter | Client setup, native config, requests, events, history, catalogs, input, errors, and cleanup | Shared orchestration and renderer state |
| Live-session adapter | Ordered controls and events, live snapshots, context, pending input, and child sessions | A second native protocol |
| Host | Startup, route registration, service wiring, commands, and lifecycle guards | Guessed routes |
| Frontend | Capability-based UI, normalized transcript, queries, and operation errors | Native payloads |

Put shared data in `packages/contracts` only when it is an OpenDucktor concept. Keep SDK options and protocol details in the native adapter.

Create and subscribe the live-session adapter before the runtime can send events. Use TanStack Query for stable frontend reads such as history and catalogs. Keep live transcript state in the live-session store.

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

The adapter owns native encoding. Claude reads the staged file and sends an SDK image or document block. Its catalog permits JPEG, PNG, GIF, WebP, and PDF. Codex maps images to `localImage`. OpenCode sends a native file part with MIME type and local URL.

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
| Optional | Queued messages, history, approvals, questions, attachments, slash commands, file search, skill and subagent references, profiles, variants, todos, diff, file status, MCP status, and subagents |

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

On reload, the host reads exact root references from durable task session records. The OpenCode adapter can call `session.get`, `session.children`, `session.status`, `permission.list`, and `question.list` for those roots and their verified descendants. It cannot call `session.list` or treat runtime data as proof that a new root belongs to OpenDucktor.

A fresh or forked session starts with a running lease. An old native idle event cannot mark it idle before the first turn settles.

Resume keeps the current running turn, approval, or question until a newer native event replaces it. One ordered coordinator applies control results and native events.

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

Keep names that the runtime accepts. A bad catalog entry fails that catalog request and names the entry. It does not block history or session reads.

### Permissions and pending input

Shared role policy lists canonical `odt_*` tools. The descriptor maps them to native aliases and lists native tools blocked for read-only roles.

Inherit native permissions and sandbox settings. Add session hooks through SDK options. Let unclassified tools use the native approval path. Shared code does not edit user settings or parse shell commands.

Do not block Bash only because a role is read-only. Spec, Planner, and QA need it for search and checks.

OpenDucktor request IDs are opaque handles. Keep native reply IDs inside the adapter. A child owns its approvals and questions. The parent can show that the child needs input, but the child transcript must also show and resolve it.

### Optional feature rules

| Feature | Rule |
|---|---|
| Todos | Live events and history build the same todo list and tool name. |
| Subagents | Parent and child keep the description, mode, ID, transcript, pending input, and final state. |
| Queued messages | One user-message ID keeps queued state live and in history. |
| Compaction | Map requested, started, completed, and failed states without showing synthetic control messages. |

## Code map

| Part | Path |
|---|---|
| Schemas | `packages/contracts/src/agent-runtime-schemas.ts`, `packages/contracts/src/agent-engine-schemas.ts` |
| Live-session port | `packages/host/src/ports/agent-session-live-adapter-port.ts` |
| Live-session adapters | `packages/host/src/adapters/agent-sessions` |
| Runtime registry | `packages/host/src/adapters/runtimes/runtime-registry.ts` |
| Native adapters | `packages/adapters-opencode-sdk/src`, `packages/adapters-codex-app-server/src`, `packages/host/src/adapters/claude` |
