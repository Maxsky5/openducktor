# Runtime Integration Guide

This guide describes OpenDucktor's runtime abstraction, integration boundaries, capability contract, and shared runtime behavior.

OpenDucktor currently supports:

| Runtime | Route | Reference value |
|---|---|---|
| OpenCode (`opencode`) | `local_http` | External HTTP runtime |
| Codex (`codex`) | `stdio` | Host-managed app server |
| Claude (`claude`) | `host_service` | Host-managed SDK service |

Each runtime has a different native protocol. The adapter preserves that protocol internally and exposes shared OpenDucktor contracts externally.

## Architecture

### Runtime concepts

| Concept | Meaning | Lifetime |
|---|---|---|
| `RuntimeDescriptor` | Static identity, policy, and capabilities for one runtime kind | Application |
| `RuntimeInstanceSummary` | One running repository-scoped runtime | Runtime process |
| `RuntimeRoute` | Transient address of a running runtime | Runtime process |
| Runtime connection | Request-scoped native client input built from a resolved route | Operation |
| `AgentSessionRecord` | Durable coordinates used to reopen a session | Durable |
| Live-session adapter | Host-owned normalized state for running sessions | Runtime process |

The main data flow is:

```text
AgentSessionRecord
        │
        ▼
runtime registry ── resolves ──► RuntimeRoute
        │
        ▼
runtime adapter ── translates ──► native SDK or protocol
        │
        ▼
live-session adapter ── projects ──► normalized snapshot and events
```

`RuntimeDescriptor` contains `kind`, `label`, `description`, `readOnlyRoleBlockedTools`, `workflowToolAliasesByCanonical`, and `capabilities`. Shared code uses this descriptor instead of branching on the runtime kind.

`RuntimeInstanceSummary` contains live runtime metadata: runtime kind and ID, repository, nullable task, role, working directory, route, start time, and descriptor. It belongs at runtime-registry and adapter boundaries.

`RuntimeRoute` supports `local_http`, `stdio`, and `host_service`. A route describes a live process or service and must never be persisted.

The shared `RuntimeTransport` contract supports request-scoped `local_http` and `stdio` connections. A `host_service` runtime may resolve its service directly inside the host adapter without adding a public transport shape.

`AgentSessionRecord` persists only the external session ID, role, start time, runtime kind, working directory, and selected model. It must not contain a route, endpoint, transport, pending request, event buffer, or runtime-native reply handle.

The live-session adapter owns the normalized session snapshot, transcript state, current context usage, pending approvals and questions, parent-child links, and private native reply routes. This state is ephemeral and does not belong in SQLite, persisted task data, or a renderer cache.

Every session operation uses the runtime kind and working directory stored with the session. If that runtime is unavailable, the operation fails. It must never fall back to the repository's current default runtime.

## Integration surfaces

| Surface | Owns | Must not own |
|---|---|---|
| Shared contracts | Runtime descriptors, routes, session identity, prompt parts, events, snapshots, and history items | Native SDK types or runtime-specific parsing |
| Runtime-native adapter | Client construction, native configuration, requests, events, history, catalogs, permissions, questions, errors, and cleanup | Shared orchestration or renderer state |
| Live-session adapter | Ordered controls and events, retained snapshots, context, pending input, and child sessions | A second native protocol implementation |
| Host composition | Runtime startup, route registration, service wiring, command handlers, and lifecycle guards | Reconstructed or guessed routes |
| Frontend | Capability-driven UI, normalized transcript display, stable queries, and operation errors | Native messages, tools, or pending-input payloads |

Shared contracts belong in `packages/contracts`. Add a shared field only when it represents an OpenDucktor concept. Keep SDK options and native protocol details inside the owning runtime adapter.

The host must create and subscribe the live-session adapter before the runtime can publish session events. Otherwise startup state can be lost before the host has an owner for it.

The frontend uses TanStack Query for stable host reads such as catalogs and history. Streaming transcript state remains in the live-session store.

Before mapping native behavior, inspect the runtime's official SDK types, documentation, protocol, or source. Confirm how it represents startup, configuration, authentication, models, session lifecycle, activity, history, tools, permissions, questions, context usage, catalogs, and optional features. If the public contract does not expose enough data for a feature, leave that capability disabled.

## Capability contract

`RuntimeDescriptor.capabilities` tells shared code what a runtime can do. Every enabled field must have a working adapter path and matching UI behavior.

### Provisioning and workflow

| Field | Meaning |
|---|---|
| `provisioningMode` | Whether OpenDucktor manages the runtime (`host_managed`) or connects to an external runtime (`external`) |
| `workflow.supportsOdtWorkflowTools` | Whether the runtime can execute canonical OpenDucktor workflow tools |
| `workflow.supportedScopes` | Supported session scopes: `workspace`, `task`, and `build` |

### Session lifecycle

| Field | Meaning |
|---|---|
| `sessionLifecycle.supportedStartModes` | Supported start modes: `fresh`, `reuse`, and `fork` |
| `sessionLifecycle.supportsSessionFork` | Whether the runtime can fork an existing session |
| `sessionLifecycle.forkTargets` | Native fork boundaries: `session`, `message`, or `item` |
| `sessionLifecycle.supportsListLiveSessions` | Whether the runtime can list its live sessions |
| `sessionLifecycle.supportsQueuedUserMessages` | Whether a busy session can accept messages whose queued state remains observable |
| `sessionLifecycle.supportsPendingInputSnapshots` | Whether live snapshots retain unresolved approvals and questions |

### History

| Field | Meaning |
|---|---|
| `history.loadable` | Whether a stored session can be loaded through a supported runtime API |
| `history.fidelity` | Available detail: `none`, `message`, or `item` |
| `history.replay` | Available reconstruction: `none`, `snapshot`, `turn_items`, or `event_replay` |
| `history.stableItemIds` | Whether history items expose stable identity |
| `history.stableItemOrder` | Whether item ordering is stable across reads |
| `history.exposesCompletionState` | Whether history distinguishes running and terminal items |
| `history.limitations` | Explicit native limits that callers must know |

### Approvals

| Field | Meaning |
|---|---|
| `approvals.supportedRequestTypes` | Supported request kinds: `command_execution`, `file_change`, `permission_grant`, and `runtime_tool` |
| `approvals.supportedReplyOutcomes` | Supported replies: `approve_once`, `approve_turn`, `approve_session`, `approve_always`, and `reject` |
| `approvals.omittedPermissionBehavior` | Behavior without a reply: `deny` or `requires_explicit_response` |
| `approvals.pendingVisibility` | Where pending requests appear: `live_snapshot`, `history`, or both |
| `approvals.canClassifyMutatingRequests` | Whether the adapter can identify requests that may mutate state |
| `approvals.readOnlyAutoRejectSafe` | Whether mutating requests can be rejected safely for read-only roles |

### Structured input

| Field | Meaning |
|---|---|
| `structuredInput.supportsQuestions` | Whether the runtime can ask structured questions |
| `structuredInput.supportsMultipleQuestions` | Whether one request can contain several questions |
| `structuredInput.supportedAnswerModes` | Supported answers: `free_text`, `single_select`, and `multi_select` |
| `structuredInput.supportsRequiredQuestions` | Whether questions can require an answer |
| `structuredInput.supportsDefaultValues` | Whether questions can define defaults |
| `structuredInput.supportsSecretInput` | Whether answers can be hidden |
| `structuredInput.supportsCustomAnswers` | Whether users can answer outside the supplied options |
| `structuredInput.supportsQuestionResolution` | Whether the adapter can resolve a pending question through the runtime |
| `structuredInput.pendingVisibility` | Where pending questions appear: `live_snapshot`, `history`, or both |

### Prompt input

| Field | Meaning |
|---|---|
| `promptInput.supportedParts` | Accepted typed prompt parts: `text`, `slash_command`, `file_reference`, `folder_reference`, `skill_mention`, `subagent_reference`, `app_mention`, `plugin_mention`, and `runtime_specific` |
| `promptInput.supportsAttachments` | Whether the runtime adapter can encode file attachments |
| `promptInput.supportsSlashCommands` | Whether the runtime exposes and accepts slash commands |
| `promptInput.supportsFileSearch` | Whether the composer can search native file or folder references |
| `promptInput.supportsSkillReferences` | Whether user-selected skills can be represented as typed prompt input |
| `promptInput.supportsSubagentReferences` | Whether user-selected subagents can be represented as typed prompt input |

#### Attachments

Attachment support has two levels:

- `promptInput.supportsAttachments` declares whether the runtime adapter can encode attachments.
- `AgentModelDescriptor.attachmentSupport` declares whether the selected model accepts `image`, `audio`, `video`, and `pdf` attachments, with optional MIME-type allowlists for each kind.

An absent `attachmentSupport` means the model did not expose attachment capability data. The composer rejects attachments that the selected model does not support or whose MIME type is outside its allowlist.

An attachment message part contains an ID, local path, name, kind, and optional MIME type. The frontend stages browser `File` data through the host before sending, then passes the staged path to the runtime adapter.

The native encoding belongs to the runtime adapter. Claude reads the staged file and sends an SDK image or document content block; its catalog allows JPEG, PNG, GIF, and WebP images plus PDF documents. Codex maps supported images to `localImage`. OpenCode sends a native file part with its MIME type and local file URL.

Slash commands and attachments cannot be combined in one prompt because slash commands use a separate native execution path.

### Optional surfaces

| Field | Meaning |
|---|---|
| `optionalSurfaces.supportsProfiles` | Whether the runtime exposes model or agent profiles |
| `optionalSurfaces.supportsVariants` | Whether the runtime exposes model variants such as reasoning effort |
| `optionalSurfaces.supportsTodos` | Whether native task state can map to OpenDucktor todos |
| `optionalSurfaces.supportsDiff` | Whether the runtime exposes session or workspace diffs |
| `optionalSurfaces.supportsFileStatus` | Whether the runtime exposes file status |
| `optionalSurfaces.supportsMcpStatus` | Whether the runtime exposes MCP connection state |
| `optionalSurfaces.supportsSubagents` | Whether OpenDucktor can observe runtime-owned subagent execution |
| `optionalSurfaces.supportedSubagentExecutionModes` | Supported subagent modes: `foreground` and `background` |

### Consistency rules

- Every runtime supports `fresh`.
- Fork start mode, fork support, and fork targets must agree.
- Item-level history requires loadable history, stable IDs, stable order, and completion state.
- A runtime without loadable history uses `none` for history fidelity and replay.
- A runtime that exposes approval requests supports both rejection and at least one approval outcome.
- Read-only auto-rejection requires mutating-request classification and rejection support.
- A runtime without structured questions declares no question details, answer modes, or pending visibility.
- A runtime with structured questions declares at least one answer mode and supports question resolution.
- Live pending-input visibility requires pending-input snapshots.
- Every runtime accepts text prompt input.
- Slash commands, file search, skill references, and subagent references must agree with their typed prompt parts.
- A runtime without subagent support declares no subagent execution modes.

### OpenDucktor capability policy

`runtimeCapabilityKeyValues` defines the descriptor fields used as product capability gates. Other descriptor fields refine those gates but are not independent gates.

| Policy set | Capability keys |
|---|---|
| Mandatory | `workflow.supportsOdtWorkflowTools`, `approvals.readOnlyAutoRejectSafe`, `sessionLifecycle.supportedStartModes`, `promptInput.supportedParts` |
| Optional | `sessionLifecycle.supportsQueuedUserMessages`, history fidelity and replay, approval request types and reply outcomes, structured questions, attachments, slash commands, file search, skill and subagent references, profiles, variants, todos, diff, file status, MCP status, subagents, and subagent execution modes |

Mandatory start-mode support means `fresh` is available. Mandatory prompt input means `text` is present in `supportedParts`.

Capability classes identify why a gate exists:

| Class | Capability keys |
|---|---|
| `baseline` | Session start modes and prompt parts |
| `workflow` | OpenDucktor workflow tools, approval request types and replies, read-only auto-rejection, and structured questions |
| `role_scoped` | Workflow scopes |
| `launch_scoped` | Session fork support and history fidelity or replay |
| `optional_enhancement` | Queued messages, attachments, slash commands, file search, skill and subagent references, profiles, variants, todos, diff, file status, MCP status, subagents, and subagent execution modes |

Supporting descriptor fields use the class of the feature they refine. Workflow aliases and read-only blocked tools are `workflow`; fork targets and history loadability, identity, ordering, and completion are `launch_scoped`; approval and structured-input details are `workflow`.

Workflow scope requirements are role-specific:

| Role | Required scopes |
|---|---|
| Spec | `workspace` |
| Planner | `workspace` |
| Builder | `build`, `workspace` |
| QA | `task` |

OpenDucktor accepts a runtime definition only when the descriptor schema is valid, workflow tools and read-only safety are available, all role scopes are covered, and every registered launch action has a supported start mode for its role. Default runtime selection also requires support for every role.

## Shared runtime behavior

### Session lifecycle and live state

Fresh and forked sessions start with a running lease. Replayed native idle state must not make a new session flicker from running to idle and back before its first turn settles.

Resume preserves a retained running turn, pending permission, or pending question until a newer native event replaces it. Control results and native events pass through one ordered coordinator so they cannot update retained state in an arbitrary order.

Renderer attachment is atomic: the first envelope contains the current snapshot, and later changes follow on the same ordered channel. Separate snapshot and subscribe operations create a race.

Native completion, stream end, runtime failure, explicit stop, and release have different meanings and must map separately. Final release removes the parent-child session tree and rejects unresolved pending requests.

Current context usage is live state, not cumulative result usage. When a direct context read races streamed context events, queued events establish the read baseline and any context event processed during the read wins, even when it repeats the retained value.

### Transcript and history

Live events and hydrated history must produce the same OpenDucktor meaning for item identity, role, order, timestamp, completion, errors, tool names, display parts, prompt references, todos, subagents, and compaction.

Use thin native live and history readers that feed the same canonical projector. Load history through the public SDK or API; history loading must not resume a session, drain live events, discover pending input, or mutate retained state.

Native history may include tool-result wrappers, synthetic messages, queue operations, local command output, compaction records, and child-agent delivery records. Classify them through native fields before generic message projection. Never filter them through displayed text, exact sentences, or regular expressions.

Use stable native IDs for messages, tool calls, retractions, and child sessions when available. Deduplicate by identity and lifecycle, not by message text.

Keep tool proposal, queueing, execution, progress, and completion separate. Measure duration from the native execution boundary. If history does not expose that boundary, omit hydrated duration rather than inventing one.

Every tool success, failure, and denial keeps the original tool identity and reason. File edits come from structured results or supported hooks; do not infer a successful diff from tool input or read private transcripts to recover one.

Accepted prompt parts remain typed until the runtime adapter encodes them. Hydrated user messages must rebuild the same command, skill, file, attachment, and subagent display parts as live messages.

### Configuration and catalogs

Inherit the user's native authentication, providers, settings, global and project instructions, models, skills, commands, permissions, sandbox policy, and MCP servers through supported SDK options. Do not create an isolated runtime home, edit user settings, or reimplement native configuration discovery from private files.

OpenDucktor may add session-scoped workflow tools, MCP servers, hooks, or instructions. These additions must not erase unrelated native configuration.

Load the effective model catalog from the runtime so proxy and third-party providers remain available.

Use structured native metadata to distinguish commands, bundled workflows, user-invocable skills, and model-invocable skills. A user-invocable skill belongs in composer autocomplete even when the model cannot invoke it. When a native API mixes kinds without a discriminator, keep the bounded classification rule in one runtime-owned module.

Preserve names accepted by the runtime. A catalog error must identify the invalid entry and remain local to that catalog request; it must not block unrelated history or session reads.

### Permissions and pending input

The shared role policy defines which canonical `odt_*` tools each role may call. The runtime descriptor maps canonical tools to native aliases and lists exact native tools blocked for read-only roles.

The adapter inherits the native permission and sandbox settings, adds session-scoped hooks through SDK options, and lets unclassified tools follow the native permission flow. It must not edit user settings or parse shell commands in shared code.

Do not block Bash only because a role is read-only. Spec, Planner, and QA need shell access for search, tests, lint, and inspection.

OpenDucktor pending-request IDs are opaque handles. Native reply IDs stay inside the adapter. A child session owns its approvals and questions; the parent may show that the child needs attention, but the child transcript must also display and resolve the request.

### Optional features

| Feature | Shared contract |
|---|---|
| Todos | Live native task changes and hydrated history produce the same canonical todo list and tool name |
| Subagents | The parent card and child session preserve initial description, execution mode, identity, transcript, pending input, and terminal state |
| Queued messages | One accepted user-message ID carries queued state live and after hydration |
| Compaction | Native requested, started, completed, and failed states map without leaking synthetic control messages into the transcript |

## Code map

- Runtime and model capability schemas: `packages/contracts/src/agent-runtime-schemas.ts`, `packages/contracts/src/agent-engine-schemas.ts`
- Live-session contract: `packages/host/src/ports/agent-session-live-adapter-port.ts`
- Live-session implementations: `packages/host/src/adapters/agent-sessions`
- Runtime registry: `packages/host/src/adapters/runtimes/runtime-registry.ts`
- Native reference adapters: `packages/adapters-opencode-sdk/src`, `packages/adapters-codex-app-server/src`, and `packages/host/src/adapters/claude`
