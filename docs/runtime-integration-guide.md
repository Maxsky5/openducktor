# Runtime Integration Guide

## Purpose

This document explains how to add a new agent runtime to OpenDucktor.

Use it when you need to:

- add a new runtime kind,
- understand the runtime capability contract,
- verify whether a runtime is eligible for integration,
- and implement the required changes across contracts, adapters, desktop orchestration, and the Rust host.

## Runtime Vocabulary

OpenDucktor uses several runtime-related payloads. Each one describes a different layer of the system.

### `RuntimeDescriptor`

Defined in `packages/contracts/src/agent-runtime-schemas.ts` and mirrored in `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs`.

It is the stable definition of a runtime kind:

- `kind`
- `label`
- `description`
- `capabilities`

Descriptors are static metadata. They are not live runtime instances.

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
| `supportsOdtWorkflowTools` | Product-required capability | Runtime can execute ODT workflow tools | Workflow roles and tool policy | Built-in OpenDucktor roles rely on this when the runtime runs ODT tools |
| `supportsPermissionRequests` | Optional enhancement | Runtime can emit permission prompts | Session event handling | Permission reply flows are only needed if the runtime emits permission prompts |
| `supportsQuestionRequests` | Optional enhancement | Runtime can emit question prompts | Session event handling | Question reply flows are only needed if the runtime emits question prompts |
| `supportsTodos` | Optional enhancement | Runtime can list session todo items | Session warmup and event refresh | Todo warmup and refresh logic read from this surface |
| `supportsDiff` | Optional enhancement | Runtime can provide session diff data | Diff inspection | Diff views call this when showing runtime-produced changes |
| `supportsFileStatus` | Optional enhancement | Runtime can provide file status data | File-status inspection | File-status inspection calls this when showing workspace state |
| `supportsMcpStatus` | Optional enhancement | Runtime exposes MCP status info | Diagnostics and health checks | Diagnostics and MCP health checks read this before querying MCP status |
| `supportedScopes` | Role-scoped | Declares where the runtime can run: `workspace`, `task`, and/or `build` | Runtime selection and host startup | The UI filters runtime choices by role, and the host rejects unsupported startup paths |
| `provisioningMode` | Whether runtime is `host_managed` or `external` | Host/runtime startup model | Startup flows use this to decide whether the host starts the runtime or connects to one that already exists |

The current codebase treats runtime integration in three layers:

- `Baseline runtime contract`: session lifecycle, streaming events, model catalog, history, and runtime diagnostics are treated as part of the required OpenDucktor runtime surface rather than as capability toggles.
- `Role-scoped support`: `supportedScopes` decides which runtime roles a runtime can serve. The UI filters runtime choices by role, and the host rejects unsupported `workspace`, `task`, or `build` startup paths.
- `Optional enhancement`: the application can work without these. The UI and runtime-health flow gate these features explicitly instead of assuming support.

The current schema does not yet model runtime-specific custom slash commands. If that surface is added later, it belongs in the `Optional enhancement` category: the app can function without it, and the UI should treat it as additive capability rather than a baseline runtime requirement.

## Eligibility Model

The current OpenDucktor runtime model expects the following pieces to exist for a runtime integration.

### Data-contract support

A runtime is represented through:

- a stable `runtimeKind`,
- a `RuntimeDescriptor` that describes its implemented capabilities,
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
- fail fast when a requested operation is unsupported,
- resolve session-scoped reads from the session runtime rather than the repo default runtime,
- expose capability flags that match the adapter and host behavior.

### Workflow compatibility

Workflow roles map onto the runtime system like this:

- `spec` and `planner` flow through workspace runtime provisioning,
- `qa` flows through task runtime provisioning,
- `build` is separate and goes through the build orchestrator, not `runtime_start`.

This is why `agentRuntimeStartRoleSchema` excludes `build` in `packages/contracts/src/run-schemas.ts`.

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
- any new route or transport schema support if the runtime is not `local_http`,
- config/session schema support for runtime-aware model defaults.

These schemas are mirrored across TypeScript and Rust, so contributors typically update them together.

### 2. Core runtime boundary

Review these files:

- `packages/core/src/ports/agent-engine.ts`
- `packages/core/src/services/runtime-connections.ts`
- `packages/core/src/types/agent-orchestrator.ts`

The runtime adapter implements the `AgentEnginePort` surface used by session orchestration and workspace inspection, especially:

- session start/resume/stop,
- streaming events,
- history,
- todos,
- model catalog,
- diff,
- file status.

If a runtime does not implement one of these surfaces, the descriptor and adapter surface should reflect that so unsupported operations fail explicitly.

### 3. Runtime adapter implementation

Reference implementation:

- `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.ts`

Related mapping files:

- `packages/adapters-opencode-sdk/src/payload-mappers.ts`
- `packages/adapters-opencode-sdk/src/session-runtime-utils.ts`

This is the layer where `RuntimeConnection` becomes runtime-specific client input. Generic orchestrator code passes connection data in, and the adapter builds the runtime-specific client from it.

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

The current capability policy helpers live in `apps/desktop/src/lib/agent-runtime.ts`. That file is where OpenDucktor classifies mandatory capabilities, role-scoped provisioning capabilities, and optional enhancement capabilities, and where the desktop runtime registry validates descriptors during registration.

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
- `supportsMcpStatus` drives diagnostics sections and MCP health checks.

`apps/desktop/src/state/operations/runtime-catalog.ts` is the main optional-capability gate for runtime diagnostics. It now skips MCP probing when `supportsMcpStatus` is false and only attempts MCP reconnect when `supportsMcpConnect` is true.
`apps/desktop/src/state/operations/runtime-catalog.ts` is the main optional-capability gate for runtime diagnostics. It now skips MCP probing when `supportsMcpStatus` is false.

When contributors add new capability-driven UI behavior, the capability information comes from runtime descriptors rather than per-session state.

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
- implement build startup support when `supportedScopes` includes `build`.

## Build Runtime Rules

Build runtime support is separate from the generic runtime-start path.

Build runtime routing is separate from the generic runtime-start path:

- `runtime_start(runtime_kind, repo, task, role)` is for task runtimes such as `qa`,
- `runtime_ensure(runtime_kind, repo)` is for workspace runtimes such as `spec` and `planner`,
- `build_start(repo, task, runtimeKind)` is the build-specific path.

For a new runtime, the build path works like this:

- when `supportedScopes` does not include `build`, the runtime is not eligible for the `build` role,
- when `supportedScopes` includes `build`, the build orchestrator starts that runtime for build worktrees,
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
