# Runtime Integration Guide

## Purpose

This document explains how OpenDucktor runtimes fit together and how to add another agent runtime.

Use it when you need to:

- add a new runtime kind,
- understand the runtime capability contract,
- verify whether a runtime is eligible for integration,
- and implement the required changes across contracts, adapters, frontend orchestration, and host startup.

## Current Support Policy

This guide describes the integration model and the runtime support policy.

- Supported runtime kinds today are OpenCode (`opencode`), Codex (`codex`), and Claude (`claude`).
- OpenCode remains the default runtime.
- Codex is supported through the local app-server adapter and host-managed stdio route.
- Claude is supported through the official Claude Agent SDK and the OpenDucktor MCP bridge. Its descriptor is the source of truth for the SDK-backed capability surface, including skills, slash commands, file search, and foreground subagents.
- New runtimes must fit the descriptor/capability model or extend that model in the same change set.

## Runtime Vocabulary

OpenDucktor uses several runtime-related payloads. Each one describes a different layer of the system.

### `RuntimeDescriptor`

Defined in `packages/contracts/src/agent-runtime-schemas.ts`.

It is the stable definition of a runtime kind:

- `kind`
- `label`
- `description`
- `readOnlyRoleBlockedTools`
- `workflowToolAliasesByCanonical`
- `capabilities`

Descriptors are static metadata. They are not live runtime instances.

`readOnlyRoleBlockedTools` is the runtime-owned list of native tool IDs that must be denied for read-only OpenDucktor roles (`spec`, `planner`, `qa`). This list is runtime-specific. OpenDucktor must not hardcode another runtime's tool names in generic orchestration code or in a different runtime adapter.

`workflowToolAliasesByCanonical` is the runtime-owned map from canonical `odt_*` workflow tool names to exact native runtime tool IDs for that runtime. Shared/core OpenDucktor code keeps canonical `odt_*` identity only and must consume this mapping when a caller needs to interpret runtime-native workflow tool IDs for authorization, tool selection, event refresh, or display.

Example:

```ts
{
  odt_set_spec: [
    "openducktor_odt_set_spec",
    "functions.openducktor_odt_set_spec",
  ],
  odt_build_completed: [
    "openducktor_odt_build_completed",
    "functions.openducktor_odt_build_completed",
  ],
}
```

The canonical `odt_*` names stay implicit and do not need to be repeated in this field.

### `RuntimeInstanceSummary`

Defined in `packages/contracts/src/run-schemas.ts`.

It is live runtime-instance metadata only:

- `kind`
- `runtimeId`
- `repoPath`
- nullable `taskId`
- `role`
- `workingDirectory`
- `runtimeRoute`
- `startedAt`
- `descriptor`

`runtimeInstanceSummaryRoleSchema` is currently `workspace` only, so this payload describes shared workspace runtime instances rather than every startup path in the system.

The host keeps this payload at runtime-registry and adapter boundaries. Higher-level orchestration carries durable request coordinates instead: `runtimeKind`, repository path, working directory, and session id when a session exists. Fresh task sessions use a transient prepare/complete/abort bootstrap handle; the handle is never persisted. The live route belongs to the repository-scoped runtime instance and is resolved again through the runtime registry when adapter operations need it.

### `RuntimeRoute`

Live host-visible route information for a running runtime.

Supported shapes:

- `{ type: "local_http", endpoint }`
- `{ type: "stdio", identity }`
- `{ type: "host_service", identity }`

This is a live route, not a persisted identifier.

### `RuntimeTransport` / runtime connection

Request-scoped runtime transport data used at the TypeScript runtime adapter boundary. The shared schema is exported as `runtimeTransportSchema` / `RuntimeTransport`; project docs and orchestration code may also refer to this concept as the runtime connection for a request.

Defined in `packages/contracts/src/agent-runtime-schemas.ts` as `runtimeTransportSchema`. `packages/core/src/services/runtime-connections.ts` contains validation helpers for runtime-kind and working-directory inputs; runtime-specific adapters convert resolved live runtime summaries and request context into their native client inputs at the adapter boundary.

Supported shapes:

- `{ type: "local_http", endpoint, workingDirectory }`
- `{ type: "stdio", identity, workingDirectory }`

The adapter boundary turns this payload into runtime-specific client input. Generic orchestration code carries the runtime kind and working directory for a request, then runtime-specific adapters resolve the live runtime and construct HTTP clients or other transport-native inputs from the `RuntimeTransport`/connection shape they own.

### Persisted session record

Defined in `packages/contracts/src/session-schemas.ts`.

Persisted records keep durable session context only:

- `externalSessionId`
- `role`
- `startedAt`
- `runtimeKind`
- `workingDirectory`
- nullable `selectedModel`

Persisted records store durable session context. `selectedModel`, when present, includes its own `runtimeKind` and must round-trip with the session. Live route or connection fields such as `runtimeRoute`, `runtimeEndpoint`, `baseUrl`, or `runtimeTransport` are never persisted; they are resolved only at the adapter call boundary.

### Ephemeral live-session state

The public contract is deliberately split by responsibility:

- `agent-session-schemas.ts` defines shared session identity and workflow scope,
- `agent-session-event-schemas.ts` defines ordered runtime/transcript events,
- `agent-session-live-schemas.ts` defines live snapshots, attachment envelopes, context reads, and pending-input replies.

The host owns one runtime-specific live adapter for each running runtime. The adapter retains only ephemeral state:

- normalized session activity and identity,
- unresolved approvals and questions,
- latest known context usage,
- parent/child session links needed by the live projection,
- and private runtime-native reply routing data.

The adapter is registered before runtime events can arrive and is released when the runtime ends. None of this state belongs in SQLite, task documents, persisted session records, or a renderer cache.

Renderer attachment is atomic: the current snapshot is the first envelope on an attachment, and every later change follows on that same ordered channel. A runtime integration must not expose separate snapshot-then-subscribe operations or require the frontend to reconcile them.

Pending-request identities exposed by this contract are opaque and runtime-neutral. Native request IDs stay private to the runtime adapter and must be validated together with runtime, session, request kind, and unresolved instance when a reply is routed.

Runtime SDK packages provide native session connections and signals; they do not retain a second normalized live projection. The host adapter is the single owner of normalized snapshots, context state, and opaque pending-request routes.

### Session routing behavior

Session-scoped operations use the session's runtime kind when loading:

- history,
- todos,
- diff,
- file status,
- model catalog.

Session controls, pending-input replies, live context reads, and context recovery go through the host live-session service. Shared application and frontend code must not select a runtime-specific live implementation. Runtime selection is confined to host adapter registration/composition.

If the runtime kind is missing, or loading cannot resolve a live repo runtime for the stored runtime kind, the operation returns an actionable error instead of silently switching runtimes. The persisted session `workingDirectory` remains the request working directory for adapter operations; it is not required to equal the repo-scoped runtime instance working directory, because build and QA sessions may run against a task worktree while reusing a repo-scoped runtime process.

## Runtime Capability Reference

Canonical capability schema: `packages/contracts/src/agent-runtime-schemas.ts`

| Capability | Class | Meaning | Where it matters | How the integration uses it |
|---|---|---|---|---|
| `provisioningMode` | Whether runtime is `host_managed` or `external` | Host/runtime startup model | Startup flows use this to decide whether the host starts the runtime or connects to one that already exists |
| `workflow.supportsOdtWorkflowTools` | Workflow requirement | Runtime can execute ODT workflow tools | Workflow roles and tool policy | Built-in OpenDucktor roles rely on this when the runtime runs ODT tools |
| `workflow.supportedScopes` | Role-scoped requirement | Declares the workflow scopes the runtime implements. For OpenDucktor integration this must include `workspace`, `task`, and `build`. | Runtime validation and host startup | Runtime registration rejects descriptors missing any required workflow scope, and the host fails fast if a runtime does not cover the full workflow scope set |
| `sessionLifecycle.supportedStartModes` | Baseline and launch-action requirement | Declares whether the runtime can start `fresh`, `reuse`, or `fork` sessions | Session start, Builder continuation, PR-generation launch actions | `fresh` is baseline-required; launch validation rejects runtimes missing start modes used by registered workflows |
| `sessionLifecycle.supportsSessionFork` / `forkTargets` | Launch-action requirement | Runtime can fork or branch an existing session and declares whether forks can target only the parent `session` or also `message`/`item` boundaries | Session controls and workflow continuity | Fork support must be internally consistent with supported start modes and target declarations; a session-only fork runtime must not be treated as message/item-boundary capable |
| `sessionLifecycle.supportsQueuedUserMessages` | Optional enhancement | Runtime can accept follow-up user messages while the current turn is still running and expose enough transcript state to mirror its queued badge behavior | Agent Studio composer, transcript rendering, and history loading | Busy-session sends stay enabled only when this flag is true; queued user turns must flow through the standard `user_message` event/history path and update in place as the runtime's pending-assistant boundary moves |
| `history` group | Baseline/optional fidelity model | Declares whether history is loadable, whether fidelity is `none`, `message`, or `item`, replay style, stable item IDs/order, and completion state | Session history loading, transcript reconstruction, adapter compatibility | Item-level history claims require stable IDs/order and completion state; runtimes without loadable history must declare `none` fidelity and replay |
| `approvals` group | Workflow requirement when prompts exist | Declares approval request types, reply outcomes, omitted-permission behavior, pending visibility, mutating-request classification, and read-only auto-reject safety | Permission prompts and read-only role enforcement | Approval request support must include `reject` plus at least one approve outcome; read-only auto-reject requires classification plus reject support |
| `structuredInput` group | Workflow requirement when questions exist | Declares structured question support, supported answer modes, pending visibility, and resolution semantics | Runtime-originated user-input requests | Runtimes that claim question support must expose answer modes and resolution state; runtimes without questions keep detail flags/lists empty |
| `promptInput.supportedParts` | Baseline with optional prompt enrichments | Declares prompt part types such as `text`, `slash_command`, file/folder references, native skill/app/plugin/subagent mentions, and `runtime_specific` structured parts | Chat composer and adapter prompt-send boundary | `text` is baseline-required; slash command, file-search, skill-reference, and subagent-reference flags must match supported structured prompt parts; runtime-specific parts must stay typed until the adapter/runtime boundary |
| `optionalSurfaces.supportsProfiles` / `supportsVariants` | Optional enhancement | Runtime supports named profiles or model variants | Session start flow and repo settings | Profile and variant selectors should read these before showing choices |
| `optionalSurfaces.supportsTodos` / `supportsDiff` / `supportsFileStatus` | Optional enhancement | Runtime can list session todos, diff, and file-status data | Session warmup and inspection views | Runtime-adapter consumers should gate these calls on descriptor support; current Agent Studio git diff/file-status views primarily use host git worktree queries rather than these adapter surfaces |
| `optionalSurfaces.supportsMcpStatus` | Optional enhancement | Runtime exposes MCP status info | Diagnostics and health checks | Diagnostics and MCP health checks read this before querying MCP status |
| `optionalSurfaces.supportsSubagents` / `supportedSubagentExecutionModes` | Optional enhancement | Runtime can surface subagents and may declare supported execution modes when it has real mode controls | Agent orchestration surfaces | Runtimes with subagent support may leave the mode list empty when no mode choice exists; disabled support must leave the mode list empty |

The current codebase treats runtime integration in these categories:

- `Baseline runtime contract`: descriptors must support fresh starts, text prompt input, and internally consistent lifecycle/history/input claims.
- `Workflow requirements`: ODT workflow tool execution, approval/input semantics, and read-only safety are modeled separately from optional UI surfaces.
- `Role-scoped workflow coverage`: `workflow.supportedScopes` must include `workspace`, `task`, and `build`. OpenDucktor does not support runtimes that cover only a subset of roles.
- `Launch-action compatibility`: `sessionLifecycle.supportedStartModes`, `sessionLifecycle.supportsSessionFork`, and `sessionLifecycle.forkTargets` must cover every registered workflow launch action.
- `Optional enhancement`: the application can work without these. New UI, adapter, and runtime-health consumers must gate optional runtime-owned surfaces explicitly instead of assuming support; existing host-owned git/worktree views may remain independent of runtime optional-surface flags.

Slash commands now belong in the optional prompt-input category: the app can function without them, and the UI treats them as additive capability rather than a baseline runtime requirement.

When `promptInput.supportsSlashCommands` is true, OpenDucktor loads a slash-command catalog through the same request/response ownership model used for stable runtime catalog data:

- repo-scoped composer warmup uses runtime-kind keyed query data before a session exists,
- active-session warmup uses the session runtime connection instead of falling back to the repo default runtime,
- filtering stays local in the composer, so typing after `/` does not trigger a runtime round-trip per keystroke.

The shared/core boundary keeps slash commands as structured message parts. The OpenCode adapter converts a leading slash-command token plus trailing text into the runtime's native `session.command` request, where the trailing text becomes the command `arguments`. If the draft cannot be represented faithfully by the runtime-specific command endpoint, the adapter fails explicitly instead of flattening the structured command back into plain text.

File search follows the same runtime-owned pattern, but with per-query reads instead of startup-loaded metadata:

- repo-scoped `@` search runs against the selected repo runtime before a session exists,
- active-session `@` search uses the session runtime connection only,
- adapters normalize runtime search hits into core `AgentFileSearchResult` items,
- structured file references stay typed through the draft/core boundary and are converted into runtime-native prompt parts only inside the runtime adapter.

If `promptInput.supportsFileSearch` is true but the runtime cannot faithfully encode the declared file/folder prompt reference parts for prompt sends, the adapter must return an actionable error instead of flattening the reference back into plain text.

Subagent references are prompt-input references, not proof that the runtime can execute managed child sessions. A runtime that supports selecting subagents in the composer must set `promptInput.supportsSubagentReferences` and declare `subagent_reference` in `promptInput.supportedParts`. The composer loads subagents through the runtime catalog path using the same repo/session runtime target used for skills and file search, then inserts typed `subagent_reference` parts from the `@` menu. The adapter owns translating those parts into native runtime prompt payloads, or failing explicitly when the runtime lacks that input contract.

This is separate from `optionalSurfaces.supportsSubagents`, which describes whether OpenDucktor can show or reason about runtime-owned subagent execution surfaces. A runtime may expose subagent execution/history surfaces without accepting subagent prompt references, and vice versa, but each claim must be backed by the corresponding adapter behavior.

When a runtime declares `promptInput.supportedParts` with `runtime_specific`, generic OpenDucktor layers may carry that part as typed data but must not reinterpret or flatten it. Only the runtime adapter that owns the capability may translate it into the native prompt payload, and unsupported runtime-specific parts must fail with an actionable error.

## Read-Only Tool Policy

Read-only role tool blocking is part of the runtime definition, not the generic role policy.

Rules:

- `AGENT_ROLE_TOOL_POLICY` continues to define which `odt_*` workflow tools each role may call.
- Each runtime descriptor must declare `readOnlyRoleBlockedTools` for runtime-native tool IDs
  that must be unavailable in read-only workflow roles. This includes native mutating
  tools and any runtime-owned tools, such as network tools, that would violate the
  read-only role contract.
- Each runtime descriptor must declare `workflowToolAliasesByCanonical` for any native workflow tool IDs that differ from canonical `odt_*` names.
- Runtime adapters must consume `readOnlyRoleBlockedTools` both when constructing runtime permission rules and when building the runtime `tools` selection sent on prompt turns for `spec`, `planner`, and `qa`.
- Runtime adapters and desktop workflow-tool consumers must resolve native workflow tool IDs through `workflowToolAliasesByCanonical` instead of hardcoded runtime prefixes in shared code.
- Do not hardcode OpenCode tool IDs in generic orchestration code or assume another runtime uses the same tool names.
- Do not block `bash` generically for read-only roles. Read-only roles still need shell access for inspections, tests, and lint commands; mutation control for shell commands remains a runtime/permission-flow concern.

For OpenCode today, the blocked list is sourced from the runtime's native tool inventory and currently includes edit-style tools such as `edit`, `write`, `apply_patch`, `ast_grep_replace`, and `lsp_rename`.

Claude currently blocks `Bash` in read-only workflow roles because the Agent SDK exposes shell execution as a single tool boundary and OpenDucktor cannot soundly distinguish every mutating shell program or flag. This adapter-owned fail-closed limitation takes precedence over shell convenience until the runtime provides a trustworthy enforcement boundary; generic orchestration must not special-case it.

## Eligibility Model

The current OpenDucktor runtime model expects the following pieces to exist for a runtime integration.

### Data-contract support

A runtime is represented through:

- a stable `runtimeKind`,
- a `RuntimeDescriptor` that describes its implemented capabilities,
- a runtime-owned `readOnlyRoleBlockedTools` list for native mutating tools,
- a runtime-owned `workflowToolAliasesByCanonical` map for native workflow tool IDs,
- a live `RuntimeRoute` compatible with current host-visible route schemas,
- a request-scoped runtime transport/connection shape,
- persisted session records that keep `externalSessionId`, `role`, `startedAt`, `runtimeKind`, `workingDirectory`, and nullable `selectedModel`.

### Transport behavior

The current transport model assumes only these shared invariants:

- live routes are described by `RuntimeRoute`,
- request-scoped adapter inputs are described by the `RuntimeTransport` schema and the runtime connection concept,
- working directories are absolute and non-traversing,
- transport-specific client construction stays inside the runtime adapter or host boundary that owns that transport.

Today the shared contracts support:

- `local_http` live routes and runtime connections for OpenCode's HTTP surface,
- `stdio` live routes and runtime connections for non-HTTP-capable runtime plumbing,
- `host_service` live routes for in-process host-managed runtime services such as Claude Agent SDK.

When a runtime-specific operation only works over one transport, the adapter or host branch must reject unsupported route or connection types explicitly instead of coercing them into HTTP.

### Runtime behavior

Within that model, runtime behavior looks like this:

- honor the selected model/profile/variant when capabilities claim support,
- support session loading from persisted `runtimeKind`, `workingDirectory`, and model/session context,
- cover every OpenDucktor workflow role by implementing all required runtime scopes: `workspace`, `task`, and `build`,
- fail fast when a requested operation is unsupported,
- resolve session-scoped reads from the session runtime rather than the repo default runtime,
- expose capability flags that match the adapter and host behavior.

### Workflow compatibility

Workflow roles map onto the runtime system like this:

- `spec` and `planner` require `workspace` scope and use workspace runtime provisioning,
- `qa` requires `task` scope and runs against the task/build working directory through the shared runtime orchestration path,
- `build` requires `build` and `workspace` scope and uses the dedicated Builder startup path.

Required workflow scope coverage lives in `runtimeRequiredScopesByRole` and `requiredRuntimeSupportedScopes` in `packages/contracts/src/agent-runtime-schemas.ts`. Launch-action role and start-mode compatibility are exported through `SESSION_LAUNCH_ACTIONS` in `packages/frontend/src/features/session-start/session-start-launch-options.ts`; the source registry currently lives in `packages/frontend/src/lib/session-launch-actions.ts`.

Even though these roles route through different startup paths, every runtime integration must support all of them. OpenDucktor does not allow registering a runtime that handles only `spec`, only `planner`, or any other partial subset.

## Launch actions and start-mode compatibility

Runtime integrations must support the session start modes used by the launch-action registry:

- `fresh`: create a new session
- `reuse`: continue an existing session
- `fork`: create a new session from an existing source session

Current workflow implications:

- `build_implementation_start` is `fresh` only
- `build_after_qa_rejected`, `build_after_human_request_changes`, and `build_rebase_conflict_resolution` allow `fresh` and `reuse`
- `build_pull_request_generation` allows `reuse` and `fork`
- `qa_review` allows `fresh` and `reuse`

This makes `sessionLifecycle.supportsSessionFork` and a compatible `fork` start mode a hard requirement for full Builder compatibility. `sessionLifecycle.forkTargets` describes the fork boundary: `session` for cloning an existing session as a whole, plus optional `message` and `item` targets when the runtime can fork from finer-grained history boundaries. A runtime that cannot fork an existing Builder session cannot implement the complete OpenDucktor Builder workflow, and a session-boundary-only runtime must not be treated as capable of message/item fork targeting.

## Integration Surfaces

Treat the layers below as the canonical runtime-integration surfaces. The exact helper files and UI consumers can move over time; preserve the ownership boundaries and runtime contracts even when filenames change.

### 1. Shared contracts

Start with the runtime-visible schemas in `packages/contracts/src/agent-runtime-schemas.ts`, `packages/contracts/src/runtime-descriptors.ts`, `packages/contracts/src/run-schemas.ts`, `packages/contracts/src/session-schemas.ts`, and related config schemas.

At this layer, update:

- the new `runtimeKind` in curated lists and descriptors,
- runtime capability metadata, including `readOnlyRoleBlockedTools` and `workflowToolAliasesByCanonical`,
- any new route or transport schema support,
- runtime-aware config and persisted session fields.

These contracts are the host-visible source of truth, so downstream adapters, host services, frontend orchestration, and docs must stay aligned in the same change set.

### 2. Core boundaries and runtime protocol adapters

The core boundaries are anchored by `packages/core/src/ports/agent-engine.ts` and the runtime-kind/working-directory helpers in `packages/core/src/services/runtime-connections.ts`. History, catalogs, and workspace inspection remain request/response runtime surfaces. Live sessions use the normalized live-session port and are implemented by host-owned adapters.

This layer must cover:

- normalized session controls, ordered live snapshots/events, context loading, pending-input replies, and runtime release,
- history, todos, model catalog, slash-command catalog, diff, and file status without coupling history to live hydration,
- explicit failure for unsupported operations instead of descriptor/adapter mismatches.

Reference implementation anchors today are `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.ts`, `packages/adapters-codex-app-server/src/index.ts`, and their supporting mapping and workflow-tool permission modules.

Runtime-native protocol logic stays in those runtime packages. Host wrappers under `packages/host/src/adapters/agent-sessions` turn each implementation into the same normalized host port. Shared host application code and frontend code must never branch on runtime kind to interpret live state.

For Builder PR generation, the runtime integration is responsible for making provider-native git or PR tools available to the agent. OpenDucktor persists the authoritative PR metadata only after the agent calls `odt_set_pull_request(taskId, providerId, number)`, then resolves the canonical provider record itself.

### 3. Frontend and shell runtime orchestration

The main shared frontend anchors are `packages/frontend/src/state/agent-runtime-services.ts`, `packages/frontend/src/lib/agent-runtime.ts`, and `packages/frontend/src/state/operations/agent-orchestrator/runtime/runtime.ts`. The Electron shell under `apps/electron` and the browser runner under `packages/openducktor-web` both mount `@openducktor/frontend` through shell bridge adapters.

Frontend/runtime orchestration must keep these rules true:

- session-scoped reads carry explicit `runtimeKind`,
- live controls carry only normalized session refs, workflow scope, model, and message data; each runtime-specific host adapter resolves and injects its native effective policy internally,
- capability-driven UI behavior comes from runtime descriptors rather than per-session heuristics,
- persisted session loading fails on runtime-kind mismatches,
- the session collection commits the initial normalized live snapshot once and derives sidebar counts from that same collection,
- selected-session history and missing-context loading are independent, on-demand operations,
- pending input and retained context never wait for transcript history.

Catalog/query helpers, session-start UI, settings, and diagnostics consumers may move, but they must continue to derive runtime behavior from the same descriptor-owned capability model.

### 4. Session persistence and loading

Persistence and loading live across the session lifecycle/persistence modules under `packages/frontend/src/state/operations/agent-orchestrator/` and the TypeScript host session document/store services under `packages/host/src/application` and `packages/host/src/adapters/sqlite`.

This layer must ensure that:

- persisted session records keep `externalSessionId`, `role`, `startedAt`, `runtimeKind`, `workingDirectory`, and nullable `selectedModel` with `selectedModel.runtimeKind` when present,
- session loading re-resolves a live repo runtime from `runtimeKind` and repo path, then preserves the persisted session `workingDirectory` for adapter requests,
- missing runtimes and mismatched runtime kind or repo identity are rejected,
- session-scoped reads continue to resolve from the stored session runtime instead of the repo default runtime,
- repository hydration does not load transcript history for every live session,
- `loadSessionHistory` remains a pure history operation and never discovers pending input, drains event buffers, resumes a runtime for context, or mutates the live projection.

### 5. Host integration

Host-visible runtime support is anchored by the shared TypeScript contracts and the TypeScript host runtime registry.

Current TypeScript host anchors:

- `packages/host/src/application/agent-sessions/agent-session-live-state-service.ts`
- `packages/host/src/adapters/agent-sessions/live-session-adapter-registry.ts`
- `packages/host/src/adapters/agent-sessions/codex-live-session-adapter.ts`
- `packages/host/src/adapters/agent-sessions/opencode-live-session-adapter.ts`
- `packages/host/src/adapters/runtimes/runtime-registry.ts`
- `packages/host/src/adapters/opencode/opencode-workspace-runtime-starter.ts`
- `packages/host/src/adapters/codex/codex-workspace-runtime-starter.ts`
- `packages/host/src/adapters/system/tool-discovery.ts`
- `packages/host/src/infrastructure/process/process-command-resolution.ts`
- `packages/host/src/infrastructure/process/process-command-launch.ts`
- `packages/host/src/application/runtimes/runtime-orchestrator-service.ts`

Host integration work includes:

- adding the runtime kind to descriptors and registration data,
- adding the runtime definition to the host-visible runtime registry so default runtime config and startup validation know about it,
- implementing runtime startup and registering it in the host registry with the correct default startup config,
- preparing and registering the live-session adapter before runtime event ingestion or runtime advertisement,
- applying every adapter projection mutation and emitted normalized change through the host coordinator,
- releasing exactly that runtime's ephemeral projection on explicit stop, removal, or unexpected exit,
- ensuring runtime config defaults are derived from the same runtime definition set used by the host registry,
- making `runtime_definitions_list`, `runtime_list`, `runtime_ensure`, `repo_runtime_health`, and `build_start` understand it where applicable,
- implementing host-managed or external provisioning correctly,
- preserving full workflow scope coverage (`workspace`, `task`, and `build`).

Context loading may use different native strategies behind the host adapter. An adapter must return retained context immediately when it has it and deduplicate concurrent recovery for the same session. If native recovery is expensive, it must remain explicit and session-scoped. For Codex specifically, historical token usage requires an adapter-internal resume/rejoin with turns included; `excludeTurns: true` does not replay the token-usage notification. That protocol rule must not leak into shared contracts or frontend code.

When you need the surrounding host implementation, follow the owning module boundary (`runtime_orchestrator`, `build_orchestrator`, registry, or startup helpers) instead of treating any one file list as exhaustive.

## Queued User Messages

Queued user messages are a runtime-owned transcript lifecycle, not a desktop placeholder system.

Rules:

- Agent Studio may only allow a follow-up free-form send while a session is already working when the active runtime descriptor sets `sessionLifecycle.supportsQueuedUserMessages: true`.
- Waiting-input states still win. If the session is blocked on a permission or question, the composer must keep free-form sends disabled even when queued follow-ups are supported.
- Queued turns still use the existing `user_message` contract. OpenDucktor does not add a separate queued-message event type.
- When a runtime accepts a queued user message before a native echo is available, the adapter must emit it through the same `user_message` event contract and dedupe the later native echo.
- For OpenCode, queued state mirrors the TUI heuristic: a user message is `queued` when its id sorts after the last assistant message whose `time.completed` is still missing; otherwise it is `read`.
- The adapter must update the same user message id in place as that pending-assistant boundary changes rather than inventing a separate queued-message event type or local placeholder system.
- History loading must apply the same pending-assistant rule so live state and reloaded history stay aligned.
- If a runtime cannot provide enough information to reproduce its own queued badge behavior through the normal message/event/history surfaces, leave `sessionLifecycle.supportsQueuedUserMessages` disabled instead of simulating the feature in desktop code.

## Build Runtime Rules

Build runtime support is separate from workspace runtime acquisition.

Every fresh task-scoped role uses `task_session_bootstrap_prepare`. The host creates or strictly validates the deterministic canonical task worktree, ensures the selected runtime at repository scope, and returns the worktree for adapter session startup. Copy paths and pre-start hooks run only for first creation. The frontend calls `complete` after persistence and observer attachment or `abort` on failure; only Builder completion transitions to `in_progress`. `build_start` remains a compatibility wrapper over the same bootstrap.

Persisted legacy sessions are not migrated. Reuse and history operations continue using their recorded runtime kind and working directory, while repository-root-backed task sessions cannot be forked into a new task session.

Role-to-scope requirements come from `runtimeRequiredScopesByRole` in `packages/contracts/src/agent-runtime-schemas.ts`, while launch-action start-mode compatibility is exported through `SESSION_LAUNCH_ACTIONS` in `packages/frontend/src/features/session-start/session-start-launch-options.ts` and sourced from `packages/frontend/src/lib/session-launch-actions.ts`.

For a new runtime, the build path works like this:

- because integrated runtimes must include every required workflow scope, `workflow.supportedScopes` must already contain `build`, `task`, and `workspace`,
- when full workflow scope coverage is present, the build orchestrator ensures the selected runtime kind and uses the prepared build worktree as the Builder session working directory,
- if the host registry does not know how to ensure that runtime kind or validate it for build bootstrap, build startup returns an error instead of launching a different runtime.

## Verification Checklist

Before you consider a new runtime integrated, verify all of the following.

### Contracts

- TypeScript schemas cover descriptor, route, run summary, and persisted session fields.
- `selectedModel.runtimeKind` survives round-trip through the host store.

### Frontend/runtime orchestration

- session history loading reads from the persisted runtime kind,
- todo/model-catalog warmups use the session runtime kind,
- event-driven todo refresh uses the session runtime kind,
- runtime-owned diff and file-status requests, where implemented, are capability-gated and route through the correct adapter; host-owned git/worktree views use the intended working directory.

### Host/runtime orchestration

- `runtime_list(runtime_kind, ...)` only returns that kind,
- `runtime_ensure` rejects unsupported kinds,
- build startup rejects unsupported runtime kinds,
- QA task-context runtime acquisition resolves the requested working directory without falling back to the repo default runtime,
- persisted session context is enough to re-resolve the live runtime route.

### Suggested checks

From repo root:

```sh
bun run --filter @openducktor/contracts typecheck
bun run --filter @openducktor/contracts test
bun run --filter @openducktor/core typecheck
bun run --filter @openducktor/core test
bun run --filter @openducktor/frontend typecheck
bun run --filter @openducktor/frontend test
bun run --filter @openducktor/host typecheck
bun run --filter @openducktor/host test
bun run --filter @openducktor/electron typecheck
bun run --filter @openducktor/electron test
bun run --filter @openducktor/web typecheck
bun run --filter @openducktor/web test
bun run lint
bun run build
```

Also run the focused typecheck/test commands for the touched runtime adapter packages. OpenCode-focused checks use `bun run --filter @openducktor/adapters-opencode-sdk typecheck` and `bun run --filter @openducktor/adapters-opencode-sdk test`; Codex-focused checks use `bun run --filter @openducktor/adapters-codex-app-server typecheck` and `bun run --filter @openducktor/adapters-codex-app-server test`; a new runtime package should expose equivalent scripts.

Add targeted tests for:

- persisted non-default runtime session loading,
- runtime-kind mismatch rejection,
- build runtime fail-fast behavior,
- selected-model runtime kind round-trip,
- capability-driven UI gating.

## Integration Constraints

These constraints describe the current integration surface. If a runtime does not fit them, the integration work extends the abstraction in the same change set.

### Reference implementation

The built-in runtime implementations are `opencode`, `codex`, and `claude`. OpenCode is the default and remains the broadest reference implementation. Codex is the reference for a host-managed app-server runtime that uses the stdio route and adapter-owned request/response/event mapping. Claude is the reference for a host-managed SDK runtime with adapter-owned catalog, session, and event mapping.

Codex startup snapshots are owned by the adapter's thread inventory reader. After
startup, Codex `thread/status/changed` notifications update that inventory through
the same low-level live-status write path that updates local session state.
Snapshot projection must not carry separate stale-status exceptions in higher
layers.

### Host-managed startup

For `host_managed` runtimes, the host owns orchestration, but the runtime implementation owns the startup details that produce the live route.

Current contract rules:

- shared registration no longer stores a generic `port -> route` callback on `RuntimeDefinition`,
- shared startup no longer allocates a generic startup port before every host-managed launch,
- host-managed runtimes implement `start_host_managed(...) -> HostManagedRuntimeStart`,
- that startup result is authoritative for the live `RuntimeRoute`, spawned child/process guard, and startup report,
- transport-specific startup behavior such as OpenCode's local HTTP port allocation stays inside the owning runtime implementation.

This keeps the shared startup contract route-driven. A host-managed runtime may still return `RuntimeRoute::LocalHttp` when that is real, but another runtime may return `RuntimeRoute::Stdio`, `RuntimeRoute::HostService`, or a dynamically discovered HTTP endpoint without forcing shared code to reconstruct the route from a host-picked port.

Startup telemetry follows the same rule: `port` is optional in shared startup event payloads and is only populated when a real startup port exists.

`runtime_ensure` still owns shared workspace-runtime startup, Builder startup still goes through `build_start`, and QA task-context routing still goes through build-continuation-aware orchestration rather than a separate generic task-runtime start command.

### Transport model

`RuntimeRoute` and request-scoped `RuntimeTransport`/connection data are transport-generic shared abstractions. Runtime-specific code may still require a particular transport such as `local_http`, but those constraints must stay inside the owning adapter or host path and fail explicitly for unsupported route or connection types.

### Capability interpretation

Some screens inspect only a subset of capability flags, but the descriptor still represents the full runtime surface. Runtime descriptors therefore describe implemented behavior for the whole integration, not only the parts that a specific screen reads.

## Related Files and Docs

Start with these anchor references:

- `docs/architecture-overview.md`
- `packages/contracts/src/agent-runtime-schemas.ts`
- `packages/contracts/src/run-schemas.ts`
- `packages/contracts/src/session-schemas.ts`
- `packages/core/src/ports/agent-engine.ts`
- `packages/frontend/src/state/agent-runtime-services.ts`
- `packages/frontend/src/lib/agent-runtime.ts`
- `packages/frontend/src/state/operations/agent-orchestrator/runtime/runtime.ts`
- `packages/host/src/adapters/runtimes/runtime-registry.ts`
- `packages/host/src/adapters/system/tool-discovery.ts`
- `packages/host/src/infrastructure/process/process-command-resolution.ts`
- `packages/host/src/infrastructure/process/process-command-launch.ts`
- `packages/host/src/adapters/codex/codex-workspace-runtime-starter.ts`
- `packages/host/src/adapters/opencode/opencode-workspace-runtime-starter.ts`

From there, follow the owning layer (`runtime_orchestrator`, `build_orchestrator`, runtime adapters, or session persistence) instead of treating this list as an exhaustive file inventory.
