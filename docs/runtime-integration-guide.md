# Runtime Integration Guide

## Purpose

This document explains how to add a new agent runtime to OpenDucktor.

Use it when you need to:

- add a new runtime kind,
- understand the runtime capability contract,
- verify whether a runtime is eligible for integration,
- and implement the required changes across contracts, adapters, desktop orchestration, and the Rust host.

## Current Support Policy

This guide describes the integration model, not the list of runtimes that are already supported in production.

- The only supported runtime today is OpenCode (`opencode`).
- Codex is the next planned runtime.
- OpenDucktor will support open-source agent runtimes only.
- Claude Code is intentionally out of scope.

## Runtime Vocabulary

OpenDucktor uses several runtime-related payloads. Each one describes a different layer of the system.

### `RuntimeDescriptor`

Defined in `packages/contracts/src/agent-runtime-schemas.ts` and mirrored in `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs`.

It is the stable definition of a runtime kind:

- `kind`
- `label`
- `description`
- `readOnlyRoleBlockedTools`
- `capabilities`

Descriptors are static metadata. They are not live runtime instances.

`readOnlyRoleBlockedTools` is the runtime-owned list of native tool IDs that must be denied for read-only OpenDucktor roles (`spec`, `planner`, `qa`). This list is runtime-specific. OpenDucktor must not hardcode another runtime's tool names in generic orchestration code or in a different runtime adapter.

### `RuntimeInstanceSummary`

Defined in `packages/contracts/src/run-schemas.ts` and mirrored in Rust runtime domain types.

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

The host returns this payload after listing, ensuring, or starting a runtime. It tells the frontend which runtime instance is running, which repo/task scope it belongs to, where its working directory is, how to reach it through `runtimeRoute`, and which static runtime definition it comes from through `descriptor`.

### `RuntimeRoute`

Live host-visible route information for a running runtime.

Supported shape:

- `{ type: "local_http", endpoint }`

This is a live route, not a persisted identifier.

### `RuntimeConnection`

Request-scoped adapter input used by the TypeScript runtime adapter boundary.

Defined in `packages/contracts/src/agent-runtime-schemas.ts` as `runtimeTransportSchema` and consumed through `packages/core/src/services/runtime-connections.ts`.

Supported shape:

- `endpoint?: string`
- `workingDirectory: string`

The adapter boundary turns this payload into runtime-specific client input. Generic orchestration code uses `RuntimeConnection` to describe where a request should run and which working directory it applies to.

### Persisted session record

Defined in `packages/contracts/src/session-schemas.ts` and mirrored by `apps/desktop/src-tauri/crates/host-domain/src/document.rs`.

Persisted records keep durable identity only:

- `runtimeKind`
- `workingDirectory`
- `externalSessionId`
- optional `selectedModel`

Persisted records store durable session context. Live route fields such as `runtimeEndpoint`, `baseUrl`, or `runtimeTransport` are resolved again when the session is loaded.

### Session routing behavior

Session-scoped operations use the session's runtime kind when loading:

- history,
- todos,
- diff,
- file status,
- model catalog.

If the runtime kind is missing, or hydration resolves to a runtime with a different kind or working directory than the stored session context, the operation returns an actionable error instead of silently switching runtimes.

## Runtime Capability Reference

Canonical capability schema: `packages/contracts/src/agent-runtime-schemas.ts`

| Capability | Class | Meaning | Where it matters | How the integration uses it |
|---|---|---|---|---|
| `supportsProfiles` | Optional enhancement | Runtime supports named profiles or agents | Session start flow and repo settings | Profile selectors read this before showing profile choices |
| `supportsVariants` | Optional enhancement | Runtime supports model variants | Session start flow and repo settings | Variant selectors read this before showing variant choices |
| `supportsSlashCommands` | Optional enhancement | Runtime exposes startup-loaded slash command metadata and can execute slash commands from the chat composer | Agent Studio composer and runtime catalog queries | The composer only opens slash autocomplete when this flag is true, loads commands through the same query-owned startup path as runtime catalogs, and keeps unsupported runtimes on plain-text `/` behavior |
| `supportsOdtWorkflowTools` | Product-required capability | Runtime can execute ODT workflow tools | Workflow roles and tool policy | Built-in OpenDucktor roles rely on this when the runtime runs ODT tools |
| `supportsSessionFork` | Product-required capability | Runtime can fork or branch an existing session | Session controls and workflow continuity | Runtime validation rejects integrations that cannot support OpenDucktor's fork-capable session model |
| `supportsQueuedUserMessages` | Optional enhancement | Runtime can accept follow-up user messages while the current turn is still running and expose enough transcript state to mirror its queued badge behavior | Agent Studio composer, transcript rendering, and history hydration | Busy-session sends stay enabled only when this flag is true; queued user turns must flow through the standard `user_message` event/history path and update in place as the runtime's pending-assistant boundary moves |
| `supportsPermissionRequests` | Optional enhancement | Runtime can emit permission prompts | Session event handling | Permission reply flows are only needed if the runtime emits permission prompts |
| `supportsQuestionRequests` | Optional enhancement | Runtime can emit question prompts | Session event handling | Question reply flows are only needed if the runtime emits question prompts |
| `supportsTodos` | Optional enhancement | Runtime can list session todo items | Session warmup and event refresh | Todo warmup and refresh logic read from this surface |
| `supportsDiff` | Optional enhancement | Runtime can provide session diff data | Diff inspection | Diff views call this when showing runtime-produced changes |
| `supportsFileStatus` | Optional enhancement | Runtime can provide file status data | File-status inspection | File-status inspection calls this when showing workspace state |
| `supportsMcpStatus` | Optional enhancement | Runtime exposes MCP status info | Diagnostics and health checks | Diagnostics and MCP health checks read this before querying MCP status |
| `supportedScopes` | Product-required scope coverage | Declares the workflow scopes the runtime implements. For OpenDucktor integration this must include `workspace`, `task`, and `build`. | Runtime validation and host startup | Runtime registration rejects descriptors missing any required workflow scope, and the host fails fast if a runtime does not cover the full workflow scope set |
| `provisioningMode` | Whether runtime is `host_managed` or `external` | Host/runtime startup model | Startup flows use this to decide whether the host starts the runtime or connects to one that already exists |

The current codebase treats runtime integration in three layers:

- `Baseline runtime contract`: session lifecycle, streaming events, model catalog, history, runtime diagnostics, and session fork support are treated as part of the required OpenDucktor runtime surface rather than as optional capability toggles.
- `Required workflow scope coverage`: `supportedScopes` must include `workspace`, `task`, and `build`. OpenDucktor does not support runtimes that cover only a subset of roles.
- `Optional enhancement`: the application can work without these. The UI and runtime-health flow gate these features explicitly instead of assuming support.

Slash commands now belong in the `Optional enhancement` category: the app can function without them, and the UI treats them as additive capability rather than a baseline runtime requirement.

When `supportsSlashCommands` is true, OpenDucktor loads a slash-command catalog through the same request/response ownership model used for stable runtime catalog data:

- repo-scoped composer warmup uses runtime-kind keyed query data before a session exists,
- active-session warmup uses the session runtime connection instead of falling back to the repo default runtime,
- filtering stays local in the composer, so typing after `/` does not trigger a runtime round-trip per keystroke.

The shared/core boundary keeps slash commands as structured message parts. The OpenCode adapter converts a leading slash-command token plus trailing text into the runtime's native `session.command` request, where the trailing text becomes the command `arguments`. If the draft cannot be represented faithfully by the runtime-specific command endpoint, the adapter fails explicitly instead of flattening the structured command back into plain text.

## Read-Only Tool Policy

Read-only role tool blocking is part of the runtime definition, not the generic role policy.

Rules:

- `AGENT_ROLE_TOOL_POLICY` continues to define which `odt_*` workflow tools each role may call.
- Each runtime descriptor must declare `readOnlyRoleBlockedTools` for that runtime's native mutating tool IDs.
- Runtime adapters must consume `readOnlyRoleBlockedTools` both when constructing runtime permission rules and when building the runtime `tools` selection sent on prompt turns for `spec`, `planner`, and `qa`.
- Do not hardcode OpenCode tool IDs in generic orchestration code or assume another runtime uses the same tool names.
- Do not block `bash` generically for read-only roles. Read-only roles still need shell access for inspections, tests, and lint commands; mutation control for shell commands remains a runtime/permission-flow concern.

For OpenCode today, the blocked list is sourced from the runtime's native tool inventory and currently includes edit-style tools such as `edit`, `write`, `apply_patch`, `ast_grep_replace`, and `lsp_rename`.

## Eligibility Model

The current OpenDucktor runtime model expects the following pieces to exist for a runtime integration.

### Data-contract support

A runtime is represented through:

- a stable `runtimeKind`,
- a `RuntimeDescriptor` that describes its implemented capabilities,
- a runtime-owned `readOnlyRoleBlockedTools` list for native mutating tools,
- a live `RuntimeRoute` compatible with current host-visible route schemas,
- a request-scoped `RuntimeConnection`,
- persisted session records that keep `runtimeKind`, `externalSessionId`, and `workingDirectory`.

### Transport behavior

The current transport model assumes:

- live routes are `local_http`,
- endpoints use `http`,
- endpoints are loopback/localhost,
- working directories are absolute and non-traversing.

Runtimes that do not expose a local loopback HTTP surface extend:

- `runtimeRouteSchema` in `packages/contracts/src/run-schemas.ts`,
- Rust `RuntimeRoute` in `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs`,
- session loader validation in `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/session-loaders.ts`,
- and any adapter/runtime connection helpers that reconstruct local HTTP clients.

### Runtime behavior

Within that model, runtime behavior looks like this:

- honor the selected model/profile/variant when capabilities claim support,
- support session hydration from persisted `runtimeKind`, `workingDirectory`, and model/session context,
- cover every OpenDucktor workflow role by implementing all required runtime scopes: `workspace`, `task`, and `build`,
- fail fast when a requested operation is unsupported,
- resolve session-scoped reads from the session runtime rather than the repo default runtime,
- expose capability flags that match the adapter and host behavior.

### Workflow compatibility

Workflow roles map onto the runtime system like this:

- `spec` and `planner` flow through workspace runtime provisioning,
- `qa` flows through task runtime provisioning,
- `build` is separate and goes through the build orchestrator, not `runtime_start`.

This is why `agentRuntimeStartRoleSchema` excludes `build` in `packages/contracts/src/run-schemas.ts`.

Even though these roles route through different startup paths, every runtime integration must support all of them. OpenDucktor does not allow registering a runtime that handles only `spec`, only `planner`, or any other partial subset.

## Scenario and start-mode compatibility

Runtime integrations must support the session start modes used by the scenario registry:

- `fresh`: create a new session
- `reuse`: continue an existing session
- `fork`: create a new session from an existing source session

Current workflow implications:

- `build_implementation_start` is `fresh` only
- `build_after_qa_rejected`, `build_after_human_request_changes`, and `build_rebase_conflict_resolution` allow `fresh` and `reuse`
- `build_pull_request_generation` allows `reuse` and `fork`
- `qa_review` allows `fresh` and `reuse`

This makes `supportsSessionFork` a hard requirement for full Builder compatibility. A runtime that cannot fork an existing Builder session cannot implement the complete OpenDucktor Builder workflow.

## Files to Change When Adding a Runtime

This is the minimum checklist for a new runtime integration.

### 1. Shared contracts

Update all runtime-visible schemas first:

- `packages/contracts/src/agent-runtime-schemas.ts`
- `packages/contracts/src/runtime-descriptors.ts`
- `packages/contracts/src/run-schemas.ts`
- `packages/contracts/src/session-schemas.ts`
- `packages/contracts/src/config-schemas.ts`

What to add:

- the new `runtimeKind` in any curated constant lists,
- a descriptor constant whose capabilities describe implemented behavior,
- a descriptor-level `readOnlyRoleBlockedTools` list for that runtime's native mutating tool IDs,
- any new route or transport schema support if the runtime is not `local_http`,
- config/session schema support for runtime-aware model defaults.

These schemas are mirrored across TypeScript and Rust, so contributors typically update them together.

### 2. Core runtime boundary

Review these files:

- `packages/core/src/ports/agent-engine.ts`
- `packages/core/src/services/runtime-connections.ts`
- `packages/core/src/types/agent-orchestrator.ts`
- `packages/contracts/src/runtime-descriptors.ts`

The runtime adapter implements the `AgentEnginePort` surface used by session orchestration and workspace inspection, especially:

- session start/resume/stop,
- streaming events,
- history,
- todos,
- model catalog,
- slash-command catalog,
- diff,
- file status.

It must also implement the scenario-compatible session lifecycle:

- `startSession(...)` for fresh sessions
- reuse via existing session registration/resume flows
- `forkSession(...)` for scenarios that support forking, including `build_pull_request_generation`

If a runtime does not implement one of these surfaces, the descriptor and adapter surface should reflect that so unsupported operations fail explicitly.

### 3. Runtime adapter implementation

Reference implementation:

- `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.ts`
- `packages/adapters-opencode-sdk/src/workflow-tool-permissions.ts`

Related mapping files:

- `packages/adapters-opencode-sdk/src/payload-mappers.ts`
- `packages/adapters-opencode-sdk/src/session-runtime-utils.ts`

This is the layer where `RuntimeConnection` becomes runtime-specific client input. Generic orchestrator code passes connection data in, and the adapter builds the runtime-specific client from it.

For Builder PR generation, the runtime integration is responsible for making provider-native git or PR tools available to the agent. OpenDucktor persists the authoritative PR metadata only after the agent calls `odt_set_pull_request(taskId, providerId, number)`, then resolves the canonical provider record itself.

### 4. Desktop runtime registration and orchestration

Update the runtime registry and orchestration entrypoints:

- `apps/desktop/src/state/agent-runtime-registry.ts`
- `apps/desktop/src/lib/agent-runtime.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/runtime/runtime.ts`
- `apps/desktop/src/state/operations/runtime-catalog.ts`
- `apps/desktop/src/state/operations/use-delegation-operations.ts`

This layer is where runtime selection is applied to real frontend operations:

- session-scoped reads carry explicit `runtimeKind`,
- build startup carries explicit runtime kind,
- persisted session hydration fails on runtime-kind mismatches.

These behaviors are what keep runtime routing deterministic across fresh sessions and restored sessions.

The current capability policy helpers live in `apps/desktop/src/lib/agent-runtime.ts`. That file is where OpenDucktor classifies mandatory capabilities, required workflow scope coverage, and optional enhancement capabilities, and where the desktop runtime registry validates descriptors during registration.

### 5. Session hydration and persistence

Update and verify:

- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/load-sessions.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/ensure-ready.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/session-loaders.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/events/session-helpers.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/support/persistence.ts`
- `apps/desktop/src-tauri/crates/host-domain/src/document.rs`
- `apps/desktop/src-tauri/crates/host-infra-beads/src/store/session_ops.rs`

These files own session persistence and hydration. This part of the integration reconnects stored sessions to a live runtime route.

This layer is usually verified by checking that:

- persisted session records keep `runtimeKind`, `externalSessionId`, `workingDirectory`, and `selectedModel.runtimeKind`,
- hydration re-resolves a live route from `runtimeKind` and `workingDirectory`,
- mismatched runtime kind and resolved live instance are rejected,
- session-scoped reads continue to resolve from the stored session runtime instead of the repo default runtime.

### 6. Settings and UI capability consumers

Update capability-driven UI surfaces:

- `apps/desktop/src/pages/shared/use-session-start-modal-state.ts`
- `apps/desktop/src/components/features/settings/settings-repository-agents-section.tsx`
- `apps/desktop/src/components/features/diagnostics/diagnostics-panel-model.ts`
- `apps/desktop/src/state/operations/use-checks.ts`

Concrete consumers to keep in mind:

- `supportsProfiles` and `supportsVariants` drive session-start and repo-settings controls,
- `supportsSlashCommands` drives slash autocomplete/chip behavior in the Agent Studio composer,
- `supportsMcpStatus` drives diagnostics sections and MCP health checks.

`apps/desktop/src/state/operations/runtime-catalog.ts` is the main optional-capability gate for runtime diagnostics. It now skips MCP probing when `supportsMcpStatus` is false.

When contributors add new capability-driven UI behavior, the capability information comes from runtime descriptors rather than per-session state.

## Queued User Messages

Queued user messages are a runtime-owned transcript lifecycle, not a desktop placeholder system.

Rules:

- Agent Studio may only allow a follow-up free-form send while a session is already working when the active runtime descriptor sets `supportsQueuedUserMessages: true`.
- Waiting-input states still win. If the session is blocked on a permission or question, the composer must keep free-form sends disabled even when queued follow-ups are supported.
- Queued turns still use the existing `user_message` contract. OpenDucktor does not add a separate queued-message event type.
- For OpenCode, queued state mirrors the TUI heuristic: a user message is `queued` when its id sorts after the last assistant message whose `time.completed` is still missing; otherwise it is `read`.
- The adapter must update the same user message id in place as that pending-assistant boundary changes rather than inventing a separate queued-message event type or local placeholder system.
- History hydration must apply the same pending-assistant rule so live state and reloaded history stay aligned.
- If a runtime cannot provide enough information to reproduce its own queued badge behavior through the normal message/event/history surfaces, leave `supportsQueuedUserMessages` disabled instead of simulating the feature in desktop code.

### 7. Rust host integration

Host-visible runtime support spans:

- `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs`
- `apps/desktop/src-tauri/src/commands/runtime.rs`
- `apps/desktop/src-tauri/src/commands/build.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/startup.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/prerequisites.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/registry/query.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator/registry/lifecycle.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/build_orchestrator/build_lifecycle.rs`

Host integration work:

- add the runtime kind to Rust domain enums and descriptors,
- make `runtime_list`, `runtime_ensure`, and `runtime_start` understand it,
- implement host-managed startup if `provisioningMode` is `host_managed`,
- implement build startup support while preserving full workflow scope coverage (`workspace`, `task`, and `build`).

## Build Runtime Rules

Build runtime support is separate from the generic runtime-start path.

Build runtime routing is separate from the generic runtime-start path:

- `runtime_start(runtime_kind, repo, task, role)` is for task runtimes such as `qa`,
- `runtime_ensure(runtime_kind, repo)` is for workspace runtimes such as `spec` and `planner`,
- `build_start(repo, task, runtimeKind)` is the build-specific path.

For a new runtime, the build path works like this:

- because integrated runtimes must include every required workflow scope, `supportedScopes` must already contain `build`, `task`, and `workspace`,
- when full workflow scope coverage is present, the build orchestrator starts that runtime for build worktrees,
- if the host does not know how to start that runtime yet, build startup returns an error instead of launching a different runtime.

## Verification Checklist

Before you consider a new runtime integrated, verify all of the following.

### Contracts

- TypeScript and Rust schemas agree on descriptor, route, run summary, and persisted session fields.
- `selectedModel.runtimeKind` survives round-trip through the host store.

### Desktop/runtime orchestration

- session hydration reloads history from the persisted runtime kind,
- todo/model-catalog warmups use the session runtime kind,
- event-driven todo refresh uses the session runtime kind,
- diff and file-status requests route through the correct adapter.

### Host/runtime orchestration

- `runtime_list(runtime_kind, ...)` only returns that kind,
- `runtime_ensure` and `runtime_start` reject unsupported kinds,
- build startup rejects unsupported runtime kinds,
- persisted session context is enough to re-resolve the live runtime route.

### Suggested checks

From repo root:

```sh
bun run --filter @openducktor/desktop typecheck
bun run --filter @openducktor/desktop test
bun run lint
bun run build
```

From `apps/desktop/src-tauri`:

```sh
cargo test -p host-domain
cargo test -p host-infra-beads
cargo test -p host-application
```

Add targeted tests for:

- persisted non-default runtime session hydration,
- runtime-kind mismatch rejection,
- build runtime fail-fast behavior,
- selected-model runtime kind round-trip,
- capability-driven UI gating.

## Integration Constraints

These constraints describe the current integration surface. If a runtime does not fit them, the integration work extends the abstraction in the same change set.

### Reference implementation

The built-in runtime implementation is `opencode`. Its adapter, runtime registry wiring, and Rust host startup path are the concrete example of how the current abstraction is implemented end-to-end.

### Host-managed startup

For `host_managed` runtimes, the Rust host contains the startup and readiness logic. Generic runtime commands call into that per-runtime implementation when a workspace runtime, task runtime, or build runtime is started.

### Transport model

`RuntimeRoute` and several validation paths assume loopback HTTP. Runtimes that use sockets, stdio, remote HTTPS, or non-local transports extend the route and transport abstractions as part of the integration.

### Capability interpretation

Some screens inspect only a subset of capability flags, but the descriptor still represents the full runtime surface. Runtime descriptors therefore describe implemented behavior for the whole integration, not only the parts that a specific screen reads.

## Related Files and Docs

- `docs/architecture-overview.md`
- `docs/agent-runtime-implementation-plan.md`
- `packages/contracts/src/agent-runtime-schemas.ts`
- `packages/contracts/src/run-schemas.ts`
- `packages/contracts/src/session-schemas.ts`
- `packages/core/src/ports/agent-engine.ts`
- `apps/desktop/src/state/agent-runtime-registry.ts`
- `apps/desktop/src/state/operations/agent-orchestrator/runtime/runtime.ts`
- `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs`
- `apps/desktop/src-tauri/crates/host-application/src/app_service/runtime_orchestrator.rs`
