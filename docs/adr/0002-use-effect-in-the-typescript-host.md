---
status: accepted
date: 2026-05-17
---

# Use Effect in the TypeScript host

## Context

`packages/host` is the transport-neutral host for Electron and the browser runner. It owns command routing, use cases, ports, adapters, runtime lifecycle, task storage, Git, file access, MCP bridges, dev servers, and shutdown.

The old Promise-based code spread expected failures, dependency wiring, cleanup, and background work across `async` functions, `try` blocks, error objects, and manual port setup. Effect changes how host ports, services, adapters, command handlers, and tests model that work. This is an architecture choice, not a local code style.

## Decision

Use Effect for host work that performs I/O or can fail.

- Host ports return `Effect.Effect<Success, Failure, Requirements>` when they perform I/O or can fail.
- Application services use `Effect.gen` and typed failures.
- Expected host failures use tagged errors, usually `Data.TaggedError`.
- Adapters wrap Node, process, file, HTTP, and third-party Promise APIs with `Effect.try`, `Effect.tryPromise`, or resource operators.
- Use `Context.Tag` and `Layer` when they make dependency setup clear.
- Keep Promise values at Electron IPC, browser HTTP/SSE, shell bridges, test harnesses, and other external Promise APIs.
- The command router provides an Effect API and a Promise adapter.
- Use a retry, polling, schedule, fiber, or fallback only when the product contract calls for it.

This decision applies to `packages/host`. It does not replace public Zod contracts or the TanStack Query cache.

## Options we rejected

- Keep a Promise-only host. It leaves expected failures, cleanup, and dependency setup implicit.
- Migrate the full monorepo at once. Each package has a different owner and boundary.
- Use Effect only in leaf adapters. The service and port contracts would still hide failures.
- Return Effect values from every public API. Shell transports and host clients need Promise-compatible APIs.

## Consequences

Host function types now show expected failures. A public transport converts those failures to errors for the caller.

Ports remain independent from adapters. The composition root provides each adapter. Effect scopes and interruption manage runtime registries, dev servers, MCP bridges, task-store lifecycle, and background work.

Other packages can adopt these rules when they have the same I/O and lifecycle needs. Make each later migration a separate change.

Contributors who change `packages/host` must understand the Effect error channel, defects, interruption, `Context`, `Layer`, and the Promise boundary. Pure policy code can stay synchronous.

## References

- [Effect documentation](https://effect.website/docs)
- [TanStack Query cache strategy](../tanstack-query-cache-strategy.md)
