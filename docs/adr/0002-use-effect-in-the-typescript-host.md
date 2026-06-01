---
status: accepted
date: 2026-05-17
---

# Use Effect in the TypeScript Host

OpenDucktor will use Effect as the internal execution model for `packages/host`, while keeping Promise interop at shell-facing transport boundaries. The host is the first package in a phased Effect adoption because it has the densest concentration of fallible I/O, dependency wiring, long-lived resources, and lifecycle orchestration.

## Context

`packages/host` is the transport-neutral TypeScript host used by Electron and the local browser shell. It owns command routing, application use cases, ports, adapters, runtime lifecycle, Beads/Dolt access, git operations, filesystem operations, MCP bridge behavior, dev-server process control, and shutdown coordination.

Before adopting Effect, this host boundary was largely Promise-based. That made I/O sequencing familiar, but expected failures, dependency wiring, resource cleanup, background coordination, and transport-boundary error mapping were spread across `async` functions, `try`/`catch`, ad hoc error objects, and manually composed ports.

Effect is a meaningful architectural commitment rather than a local implementation detail: it changes how host ports, application services, adapters, command handlers, and tests express fallibility and execution. The decision is therefore recorded here so future work does not accidentally reintroduce Promise-only orchestration into the host internals, and so later Effect migrations can reuse the same boundary discipline instead of inventing new patterns per package.

## Decision

Use Effect as the internal model for fallible and I/O-producing host work.

Concretely:

- Host ports that perform I/O or can fail return `Effect.Effect<Success, Failure, Requirements>` instead of raw `Promise`.
- Application services compose host operations with `Effect.gen` and typed failures.
- Expected host failures are modeled with tagged errors, primarily `Data.TaggedError`.
- Adapter and infrastructure code wrap external Node, process, filesystem, HTTP, and third-party Promise APIs at the edge with Effect constructors such as `Effect.try`, `Effect.tryPromise`, and resource-aware combinators.
- Dependency injection uses Effect `Context.Tag` and `Layer` where it makes the host composition root clearer.
- Promise-returning APIs remain only at external boundaries that must interoperate with Electron IPC, browser HTTP/SSE, existing shell bridges, or test harnesses.
- The command router exposes an Effect-native surface and a Promise adapter, making Promise interop explicit instead of the host's internal model.
- Retries, polling, and background work may use Effect scheduling and fibers only when they represent existing product behavior. They must not hide failures or introduce fallback paths.

This decision is scoped to `packages/host`, but it is intentionally a first step rather than the final scope of Effect in OpenDucktor. It does not migrate `packages/contracts` from Zod and does not replace TanStack Query or frontend state ownership.

## Considered Options

- Keep the host Promise-based. Rejected because the host has many fallible I/O boundaries and long-lived resources; Promise-only orchestration keeps failure types, cleanup, and dependency wiring implicit.
- Adopt Effect across the entire monorepo in one step. Rejected because a broad migration would mix packages with very different ownership models and would obscure whether Effect is improving each boundary. Frontend reads are intentionally owned by TanStack Query and shared contracts are Zod-based.
- Adopt Effect progressively, starting with `packages/host`. Accepted because the host has the clearest immediate fit and can establish reusable patterns for later migrations in runtime adapters, the local web runner, and MCP bridge code.
- Use Effect only in leaf adapters. Rejected as too shallow: it would wrap external calls but leave application orchestration and port contracts Promise-based, preserving the same ambiguity at the layer where most host decisions are made.
- Make every public host API return Effect. Rejected because shell transports, Electron IPC, browser HTTP handlers, and existing host clients need Promise-compatible boundaries.

## Consequences

The main benefit is that host failures are now part of function signatures instead of convention. Runtime startup failures, invalid command input, path access problems, missing dependencies, process failures, and lifecycle errors can be propagated as typed values until a public boundary turns them into user-visible errors.

Effect also fits the existing hexagonal host architecture. Ports map naturally to Effect service interfaces, adapters remain responsible for external systems, and the composition root can provide concrete dependencies without making application services import infrastructure modules.

Resource and lifecycle code becomes easier to reason about. Runtime registries, dev-server shutdown, MCP bridge startup/close, shared Dolt lifecycle, single-flight coordination, and background work can use Effect primitives for sequencing, interruption, and cleanup instead of open-coded Promise state.

The host migration establishes OpenDucktor's first Effect conventions. Future packages can adopt those conventions when they have similar pressure: runtime adapters with event streams and session lifecycle, `packages/openducktor-web` with launcher/readiness/SSE orchestration, and `packages/openducktor-mcp` with CLI, discovery, bridge health, and host-call error handling. Those migrations should be separate decisions or implementation slices, not incidental spillover from this ADR.

The tradeoff is a larger conceptual and type-system surface. Contributors working in `packages/host` need to understand Effect failure channels, defects, interruption, `Context`, `Layer`, and the difference between internal Effects and external Promise boundaries.

Another tradeoff is boundary discipline during phased adoption. Effect may coexist with Zod and TanStack Query, but it must not duplicate their ownership by accident. `packages/contracts` remains the public Zod contract source until a separate schema decision says otherwise. Frontend server-read caching remains owned by TanStack Query, even if future query functions or host clients internally run Effect programs.

This also creates sharper review expectations. New host code should not introduce raw Promise orchestration inside application services or ports when an Effect signature is the established boundary. Generic `throw new Error(...)` should not be used for expected host failures. Broad `catchAll`, retry, fallback, or defaulting behavior must be treated suspiciously unless the product behavior explicitly requires it.

Pure domain policy code may stay synchronous and non-Effect when it has no I/O and no meaningful typed failure channel. Keeping pure code simple is part of the decision; Effect is the host execution model, not a mandate to wrap every expression.

Relevant references:

- [Effect documentation](https://effect.website/docs)
- [TanStack Query cache strategy](../tanstack-query-cache-strategy.md)
