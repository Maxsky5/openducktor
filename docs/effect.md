# Effect Adoption Guide

This guide describes how OpenDucktor uses Effect in TypeScript packages.

The short version:

- Use Effect for fallible or I/O-producing application work.
- Keep pure domain policy synchronous when it has no useful failure channel.
- Model expected failures as typed errors.
- Use `Context.Tag` and `Layer` for dependency injection.
- Wrap Promise and throwing APIs at the adapter boundary.
- Convert Effects to Promises only at explicit external boundaries.
- Do not use Effect recovery operators to hide broken contracts.

The current reference implementation is `packages/host`. Future migrations in `packages/openducktor-web`,
`packages/openducktor-mcp`, and other eligible TypeScript packages should reuse these conventions instead of inventing
package-local Effect styles.

## Why Effect

Effect is OpenDucktor's TypeScript execution model for code that has one or more of these properties:

- it performs I/O
- it can fail with an expected application or infrastructure error
- it coordinates dependencies
- it owns a resource lifecycle
- it starts background work
- it needs deterministic retry, polling, scheduling, or interruption behavior

Effect makes those concerns explicit in the type:

```ts
Effect.Effect<Success, Failure, Requirements>
```

Read this as:

- `Success`: the value produced when the operation succeeds
- `Failure`: expected failures returned through the Effect error channel
- `Requirements`: services that must be provided through `Context` and `Layer`

JavaScript defects can still happen. They are not the same thing as expected failures. Expected failures should be typed
and propagated until a public boundary maps them to a user-visible or transport-visible error.

## Where Effect Belongs

Use Effect inside eligible TypeScript packages when the code is application, adapter, infrastructure, lifecycle, or
transport orchestration code.

Good candidates:

- host command handling and use cases
- MCP bridge discovery and host calls
- web runner startup, readiness, HTTP, and SSE orchestration
- runtime process lifecycle
- filesystem, git, Beads, Dolt, and external CLI adapters
- long-running loops, polling, retries, and shutdown logic

Do not force Effect into code that is clearer as plain TypeScript:

- pure data transforms
- pure domain predicates
- schema constants
- enum or lookup definitions
- React local UI state
- serialization-only DTO definitions

Pure code may call pure code directly. It does not become better because it returns `Effect.succeed(value)`.

## Boundaries

Effect should be internal to the package unless the package intentionally exposes an Effect-native API.

Promise interop is allowed at explicit boundaries:

- Electron IPC handlers
- browser HTTP and SSE handlers
- CLI entrypoints
- shell bridge adapters
- third-party package APIs that require Promises
- test harness boundaries

Inside an Effect-native package, avoid `async` orchestration as the main implementation style. If an external API returns
a Promise, wrap it once at the adapter boundary with `Effect.tryPromise`. Application services should compose Effects,
not Promises.

## Package Eligibility

Before migrating another package, check that Effect will improve the package's boundary rather than only changing syntax.

Effect is a good fit when the package owns fallible I/O, dependency wiring, long-lived resources, or concurrent runtime
behavior.

Effect is not automatically a good fit for:

- public contract packages where Zod schemas are the source of truth
- frontend read caching owned by TanStack Query
- small packages that only re-export types or constants
- pure domain packages with no meaningful failure or resource model

When in doubt, migrate a narrow vertical path first and document the boundary. Do not migrate an entire package just to
make every function return an Effect.

## Dependency Injection

Use Effect services for replaceable dependencies. A service is usually:

- a port in a hexagonal boundary
- an adapter dependency
- a runtime or process service
- a configuration or environment provider
- a lifecycle collaborator that tests need to replace

Define service tags with `Context.Tag`:

```ts
import type { GlobalConfig } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostPathAccessError,
  HostValidationError,
} from "../effect/host-errors";

export type SettingsConfigError = HostOperationError | HostPathAccessError | HostValidationError;

export type SettingsConfigPort = {
  readConfig(): Effect.Effect<GlobalConfig | null, SettingsConfigError>;
  canonicalizePath(path: string): Effect.Effect<string, HostOperationError>;
  join(...paths: Array<string>): string;
};

export class SettingsConfigPortTag extends Context.Tag("@openducktor/host/SettingsConfigPort")<
  SettingsConfigPortTag,
  SettingsConfigPort
>() {}
```

Provide implementations with `Layer` at the composition root:

```ts
import { Layer } from "effect";

export const SettingsConfigPortLive = Layer.succeed(
  SettingsConfigPortTag,
  createSettingsConfigAdapter(),
);
```

Use a layer when an implementation is part of application wiring. Passing dependencies manually is still acceptable for
small local factory functions, but application-level dependency graphs should be visible in one composition root.

Current host reference:

- `packages/host/src/ports/*`
- `packages/host/src/composition/node/node-host-default-ports.ts`

### Dependency Injection Rules

- Application services depend on ports, not adapters.
- Adapters implement ports and may import Node APIs or third-party APIs.
- Composition roots import adapters and provide them through layers.
- Tests replace services through local fake implementations or test layers.
- Do not add runtime probes for optional methods. If a capability is required, make it part of the port.

## Error Model

Expected failures belong in the Effect error channel.

Use `Data.TaggedError` for stable error types:

```ts
import { Data } from "effect";

export class HostOperationError extends Data.TaggedError("HostOperationError")<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}
```

Inside `Effect.gen`, return failed effects explicitly:

```ts
return yield* new HostOperationError({
  operation: "runtime.ensure",
  message: "Runtime startup failed",
  cause,
});
```

Use `Effect.catchTag` when you intentionally recover from a specific expected failure. Avoid broad `catchAll` unless the
product behavior truly handles every possible typed failure.

Do not use `try`/`catch` inside `Effect.gen` to catch Effect failures. Effect failures are not thrown JavaScript
exceptions. Use `Effect.catchTag`, `Effect.catchAll`, or `Effect.result`.

### Failure, Defect, and Interruption

Use this taxonomy during design and review:

| Category | Examples | Treatment |
| --- | --- | --- |
| Expected rejection | user denied permission, user cancelled | typed failure or explicit success value |
| Domain failure | invalid task transition, missing required input | typed failure |
| Infrastructure failure | filesystem error, process exit, git failure | typed failure at adapter boundary |
| Defect | invariant violation, impossible state, programmer mistake | let it fail loudly or convert at a public boundary |
| Interruption | shutdown, timeout, cancelled fiber | cleanup through Effect lifecycle primitives |

OpenDucktor does not add fallback behavior to mask broken contracts. If a dependency fails, propagate an actionable
typed error from the layer where the failure originates.

Current host reference:

- `packages/host/src/effect/host-errors.ts`
- `packages/host/src/domain/task/task-policy-error.ts`

## Wrapping External APIs

Use `Effect.tryPromise` for Promise-returning APIs:

```ts
const ensureDirectory = (path: string) =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      toHostOperationError(cause, "localAttachment.ensureDirectory", { path }),
  }).pipe(Effect.asVoid);
```

Use `Effect.try` for synchronous APIs that can throw, including parsers:

```ts
const parsePayload = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => toHostOperationError(cause, "payload.parse"),
  });
```

Use `Effect.sync` for synchronous code that does not throw but should run inside the Effect runtime, such as reserving
mutable process-local state before forking background work.

Do not wrap every pure expression. Prefer plain TypeScript until the code has a real Effect concern.

## Composition Style

Use `Effect.gen` for sequential application logic:

```ts
const loadWorkspace = (repoPath: string) =>
  Effect.gen(function* () {
    const settings = yield* SettingsConfigPortTag;
    const canonicalPath = yield* settings.canonicalizePath(repoPath);
    const exists = yield* settings.pathExists(canonicalPath);

    if (!exists) {
      return yield* new HostPathNotFoundError({
        path: canonicalPath,
        operation: "workspace.load",
        message: "Workspace path does not exist",
      });
    }

    return canonicalPath;
  });
```

Use `.pipe(...)` for transformations and short adapter pipelines:

```ts
Effect.tryPromise({
  try: () => stat(path),
  catch: (cause) => toHostPathStatError(cause, "attachment.exists", path),
}).pipe(
  Effect.as(true),
  Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
);
```

Avoid deeply nested operators:

```ts
// Avoid
Effect.asVoid(
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) => toHostOperationError(cause, "dir.ensure", { path }),
  }),
);

// Prefer
Effect.tryPromise({
  try: () => mkdir(path, { recursive: true }),
  catch: (cause) => toHostOperationError(cause, "dir.ensure", { path }),
}).pipe(Effect.asVoid);
```

Use named helpers when the same Effect pattern repeats enough to hide intent. Do not add a helper just to avoid one
clear `Effect.tryPromise(...).pipe(...)` expression.

## Resource and Lifecycle Management

Use Effect runtime primitives for resources and background work:

- `Effect.acquireUseRelease` or scoped layers for resources with acquire/release lifecycles
- `Effect.addFinalizer` for cleanup attached to a scope
- `Effect.fork` for background fibers
- `Fiber.join` or `Fiber.interrupt` for controlled shutdown
- `Deferred` for one-time coordination and single-flight startup
- `Ref` for mutable Effect state
- `Schedule` with `Effect.retry` or `Effect.repeat` for explicit retry and polling behavior

Single-flight startup is a common OpenDucktor pattern. Reserve the in-flight operation synchronously, then fork the work,
then complete a `Deferred` with the full `Exit` so all callers observe the same success or failure.

This matters because `Deferred.make` and `Effect.fork` can yield. If shared process state is set only after a yield, two
callers can both believe they own startup.

Current host references:

- `packages/host/src/adapters/mcp/mcp-host-bridge-server.ts`
- `packages/host/src/adapters/runtimes/runtime-registry.ts`
- `packages/host/src/adapters/beads/beads-cli-context-flight.ts`

## Scheduling and Time

Use Effect scheduling primitives for retries, polling, and loops only when they are explicit product behavior.

Prefer readable duration strings:

```ts
Effect.sleep("500 millis");
Schedule.fixed("5 seconds");
```

Do not add retries to make failures disappear. Retrying must be part of the feature contract, such as waiting for a
runtime that has just been launched.

When code needs the current time inside an Effect program, prefer Effect's clock service over `Date.now()` so tests can
control time deterministically.

## Streams

Use Effect streams when a package owns a real stream: SSE, process output, runtime events, watch mode, or subscription
state.

Rules:

- bound stream consumption in tests
- do not collect infinite streams without `Stream.take`, `takeUntil`, or an equivalent bound
- ensure stream resources are scoped and finalized
- keep backpressure behavior explicit
- convert to host or transport events only at the boundary

## Testing

Tests should run the Effect at the test boundary:

```ts
await Effect.runPromise(program);
```

For service-dependent programs, provide a test layer or a local fake service:

```ts
const TestSettingsConfig = Layer.succeed(SettingsConfigPortTag, fakeSettingsConfig);

await Effect.runPromise(program.pipe(Effect.provide(TestSettingsConfig)));
```

When using Effect test helpers with a test clock:

- advance time with `TestClock.adjust(...)`
- use live tests only when real wall-clock behavior is required
- use scoped tests for resources that require finalization
- interrupt forked fibers in cleanup paths
- use a started latch plus a gate when asserting concurrency

Do not call `Effect.runPromise(...)` inside an already-running Effect test program. Stay inside the runtime and `yield*`
the child Effect.

## Public Boundaries

Public boundaries must translate Effect results into the shape expected by the caller.

Examples:

- an Electron IPC handler returns a Promise and maps typed host errors to IPC errors
- an HTTP route returns a response body and status code
- an SSE endpoint maps stream events to transport frames
- a CLI entrypoint logs an actionable error and exits with the right code

Keep this translation at the edge. Do not force internal services to throw because a boundary eventually needs a thrown
or rejected Promise error.

## Migration Recipe

Use this sequence when migrating another eligible package:

1. Identify the real external boundaries: CLI, HTTP, IPC, SDK, filesystem, process, or transport.
2. Define typed errors for expected package failures.
3. Convert ports and application services that perform I/O or can fail to return `Effect.Effect`.
4. Add `Context.Tag` services for replaceable dependencies.
5. Provide live implementations through a package composition root.
6. Wrap Promise and throwing APIs at adapters with `Effect.tryPromise` or `Effect.try`.
7. Move resource cleanup, polling, retries, and background work to Effect runtime primitives.
8. Keep pure policy code synchronous.
9. Convert to Promise only at public boundaries.
10. Add tests for typed failures, dependency replacement, lifecycle cleanup, and concurrency when relevant.

Do this vertically. A small path that is Effect-native end to end is better than a wide migration that leaves Promise
orchestration in the middle.

## Review Checklist

Use this checklist for Effect code reviews:

- Does fallible or I/O-producing application code return `Effect.Effect`?
- Are expected failures typed with tagged errors?
- Are Promise APIs wrapped at adapter boundaries?
- Are public Promise boundaries explicit?
- Does application code depend on ports/services instead of adapters?
- Are services provided through `Context.Tag` and `Layer` where dependency wiring matters?
- Are `catchAll`, retries, and default values real product behavior rather than fallback masking?
- Does resource cleanup run on success, failure, and interruption?
- Are background fibers joined, interrupted, or owned by a scope?
- Are concurrent single-flight paths race-free before the first yield?
- Is pure code kept simple and synchronous?
- Are tests deterministic around time, streams, fibers, and scoped resources?

## Current Reference Patterns

The first OpenDucktor package migrated to Effect is `packages/host`. Use it as the reference for the next migrations, but
preserve package boundaries:

- port tags and Effect signatures: `packages/host/src/ports/*`
- shared host errors: `packages/host/src/effect/host-errors.ts`
- adapter Promise wrapping: `packages/host/src/adapters/attachments/local-attachment-adapter.ts`
- dependency composition: `packages/host/src/composition/node/node-host-default-ports.ts`
- command/router boundary: `packages/host/src/interface/router/*`
- lifecycle shutdown: `packages/host/src/composition/host-lifecycle.ts`
- single-flight runtime coordination: `packages/host/src/adapters/runtimes/runtime-registry.ts`
- MCP bridge lifecycle: `packages/host/src/adapters/mcp/mcp-host-bridge-server.ts`

The host is a reference, not a template to copy blindly. If a future package has a smaller dependency graph, use fewer
layers. If a future package owns streams or request-scoped resources, use the Effect primitives that match that shape.
