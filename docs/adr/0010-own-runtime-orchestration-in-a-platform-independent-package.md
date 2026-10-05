---
status: accepted
date: 2026-10-04
---

# Own runtime orchestration in a platform-independent package

## Context

OpenDucktor runs at most one runtime of each kind (OpenCode, Codex, Claude) for each host. All workspaces share it. The lifecycle rules are complex: one slot per kind, generations that ignore late callbacks, admission of runtime controls, reservations for lifecycle actions, startup cleanup ownership, restart after an impact review, and immediate application of saved runtime settings.

These rules first lived in the host under `adapters/runtimes`, next to Node process code. The generic registry knew each runtime kind by name, the lifecycle service also owned the settings save, and every rule used host error types. Other hosts could not reuse the rules, and a new runtime kind had to change the generic code.

## Decision

Put the runtime orchestration in `packages/runtime-orchestration` (`@openducktor/runtime-orchestration`).

- The package depends only on `@openducktor/contracts`, `@openducktor/core`, `@openducktor/path-support`, and `effect`. It imports no Node API and no host, frontend, or adapter code. Oxlint rules in `.oxlintrc.json` (`no-restricted-imports` and `max-lines`) enforce this rule.
- The package owns the domain rules (slot state, unavailable reasons, status log text, lifecycle plans, impact review and confirmations) and the application (`createRuntimeOrchestrator` with its registry and admission gate).
- A runtime kind plugs in through one port, `RuntimeDriver`: descriptor, start, version probe, executable check, session stop, and session probe. The orchestrator never names a kind.
- The package reads its other inputs through ports: `RuntimeSettingsSource`, `LiveSessionInventory`, and `RuntimeObserver`. The ports take the error type `E` of the platform, so platform errors pass through with their types.
- The package has its own typed errors. The host maps them once, in `application/runtimes/runtime-orchestration-errors.ts`, to the host errors that its callers and the frontend already handle.
- The host keeps the platform parts: the drivers in `adapters/runtimes/runtime-drivers.ts` (from the Node starters and session operations), the port adapters in `application/runtimes/host-runtime-ports.ts`, and the settings save use case in `application/runtimes/host-runtime-service.ts`. The settings save takes the lifecycle reservation, runs the orchestrator check inside its config write lock, writes, and then applies the change.

## Options we rejected

- Keep the rules in the host and only move files to an `application` folder. The rules would still use host errors and host wiring, so another host could not reuse them.
- Move each driver into its runtime adapter package. Each driver needs host process, MCP configuration, and live-session helpers, so this would add several ports without a current need. A driver can move later because it implements a package port.
- Put the rules in `@openducktor/core`. Core is plain TypeScript without Effect. The lifecycle rules depend on Effect fibers, scopes, and interruption.

## Consequences

A new runtime kind adds a descriptor in contracts and a driver in its host. The orchestrator does not change.

Another host, a command-line tool, or a test can run the orchestrator with its own drivers and ports.

The lifecycle rules have their own tests in the package. The host tests cover the drivers, the error mapping, and the settings save over the real orchestrator.

Host code reaches the shared runtimes only through `RuntimeRegistryPort` and `RuntimeAdmissionPort`. A change to the package API changes these adapters, not each host service.

## References

- `packages/runtime-orchestration/src/index.ts`
- `docs/runtime-integration-guide.md`
