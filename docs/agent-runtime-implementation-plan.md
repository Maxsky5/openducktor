# AgentRuntime Implementation Plan

## Goal

Make `AgentRuntime` a first-class concept across OpenDucktor so that adding a new runtime requires only:

- a runtime implementation in adapters/infra,
- runtime registration,
- capability-driven UI wiring,
- targeted tests.

OpenCode-specific behavior must remain isolated to adapter/infra layers.

Current product reality:

- The only supported runtime today is OpenCode (`opencode`).
- Codex is the next planned runtime.
- OpenDucktor will support open-source agent runtimes only.

## Core Domain Model

### Runtime identity

- `RuntimeKind`: stable runtime family key such as `opencode`
- `RuntimeRef`: selected runtime identity for config/session flows
- `RuntimeDescriptor`: runtime metadata and capabilities exposed to frontend/core
- `RuntimeInstance`: provisioned runtime process or connection details when applicable

### Capabilities

The runtime capability model must drive orchestration and UI:

- session lifecycle (`start`, `resume`, `stop`)
- message streaming / events
- model catalog availability
- runtime profile support
- variant support
- workflow tool support
- queued user-message support
- permission reply support
- question reply support
- history / todos / diff / file-status support
- diagnostics support
- host provisioning style

## Implementation Phases

### Phase 1 - Shared contracts

- Replace OpenCode-specific contract fields with runtime-aware abstractions.
- Add runtime descriptors and capabilities to shared schemas.
- Persist runtime kind on sessions and repo defaults.

### Phase 2 - Core ports and orchestration types

- Refactor `AgentEnginePort` to be runtime-generic.
- Replace `opencodeAgent`-based selection with runtime-scoped profile selection.
- Add capability-aware orchestration checks.

### Phase 3 - Rust host runtime registry

- Introduce generic runtime commands and host runtime orchestration.
- Move OpenCode-specific startup/process details behind the OpenCode runtime implementation.
- Replace OpenCode-only runtime config fields with runtime-scoped config.

### Phase 4 - Desktop host adapter and state

- Replace OpenCode-specific host client methods with runtime-generic methods.
- Introduce generic runtime health/catalog/state services.
- Remove direct concrete runtime wiring from app composition root.

### Phase 5 - Settings and session-start UI

- Make runtime selection first-class.
- Make model/profile/variant controls capability-driven.
- Make busy-session follow-up sends capability-driven.
- Store repo defaults per role with runtime-aware selection.

### Phase 6 - Verification

- Update tests across contracts, core, host, adapters, desktop, and UI.
- Run lint, typecheck, tests, build, and cargo test.

## Guardrails

- No fallback runtime logic.
- No OpenCode-specific fields in shared contracts or generic desktop/core types.
- No generic session state tied to transport details like OpenCode HTTP endpoint semantics.
- Capability checks are authoritative in core, not only in UI.

## Done Criteria

- Adding a runtime does not require editing generic orchestration or generic UI flow.
- OpenCode references outside adapters/infra are removed or reduced to benign naming in tests scheduled for follow-up.
- Settings and session creation are runtime-first and capability-aware.
- Host/IPC/runtime orchestration is runtime-generic.
