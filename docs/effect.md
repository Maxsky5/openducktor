# Effect guide

Read this guide before you change a host port, service, adapter, lifecycle, or typed error.

Use Effect for application work that performs I/O, can fail, owns a resource, starts background work, or needs controlled time and concurrency. Keep pure data and policy code in plain TypeScript.

The main type is:

```ts
Effect.Effect<Success, Failure, Requirements>
```

- `Success` is the result.
- `Failure` is an expected typed failure.
- `Requirements` lists services supplied through `Context` and `Layer`.

A JavaScript defect is not an expected failure. Keep expected failures in the Effect error channel until a public boundary converts them.

`packages/host` is the current reference. Use the same rules in another package only when its I/O and lifecycle need them.

## Where Effect fits

Use Effect for:

- Host commands and use cases.
- MCP bridge discovery and calls.
- Web startup, readiness, HTTP, and SSE.
- Runtime process lifecycle.
- File, Git, SQLite, and CLI adapters.
- Bounded loops, schedules, retries, polling, and shutdown.

Keep these in plain TypeScript:

- Pure transforms and predicates.
- Schema constants and lookup data.
- React local state.
- DTOs that only serialize data.
- Packages that only export types or constants.

Do not wrap a pure value in `Effect.succeed` only for style.

## Boundaries

Keep Effect inside its package unless the package exports an Effect API by design.

Convert to Promise at an Electron IPC handler, HTTP or SSE handler, CLI entry point, shell bridge, test boundary, or third-party Promise API.

Wrap an external Promise once in its adapter. Application services compose Effects, not `async` functions.

Before a package migration, check that the package owns expected failures, I/O, replaceable dependencies, resources, or concurrency. Start with one complete path. Do not convert a full package only to change syntax.

## Services and layers

Use a service for a replaceable port, adapter dependency, runtime, config source, process service, or resource owner.

Define the tag with `Context.Tag`:

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
  pathExists(path: string): Effect.Effect<boolean, HostPathAccessError>;
  join(...paths: Array<string>): string;
};

export class SettingsConfigPortTag extends Context.Tag("@openducktor/host/SettingsConfigPort")<
  SettingsConfigPortTag,
  SettingsConfigPort
>() {}
```

Provide the implementation at the composition root:

```ts
import { Layer } from "effect";

export const SettingsConfigPortLive = Layer.succeed(
  SettingsConfigPortTag,
  createSettingsConfigAdapter(),
);
```

A small local factory can pass a dependency as an argument. Use layers when the app dependency graph needs one visible setup point.

Rules:

- Services depend on ports, not adapters.
- Adapters implement ports and can import Node or third-party APIs.
- Composition roots import and provide adapters.
- Tests provide local fakes or test layers.
- A required capability belongs in the port. Do not probe for an optional method at runtime.

References: `packages/host/src/ports/*` and `packages/host/src/composition/node/node-host-default-ports.ts`.

## Error model

Use `Data.TaggedError` for a stable expected error:

```ts
import { Data } from "effect";

export class HostOperationError extends Data.TaggedError("HostOperationError")<{
  readonly message: string;
  readonly operation: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}
```

Return it from `Effect.gen`:

```ts
return yield* new HostOperationError({
  operation: "runtime.ensure",
  message: "Runtime startup failed",
  cause,
});
```

Use `Effect.catchTag` when the product handles one known error. Use `Effect.catchAll` only when the product handles every error in the channel. Use `Effect.either` when the caller needs success or failure as a value. Use `Effect.exit` when the caller also needs defect or interruption data. A JavaScript `try` block inside `Effect.gen` does not catch an Effect failure.

| Category | Example | Treatment |
|---|---|---|
| Rejection | User denied permission | Typed failure or an explicit success result |
| Domain failure | Invalid task transition | Typed failure |
| Infrastructure failure | File error or process exit | Typed failure at the adapter |
| Defect | Broken invariant | Fail, or convert at the public boundary |
| Interruption | Shutdown or canceled fiber | Run Effect cleanup |

Do not hide a failed dependency with a fallback. Return an error from the layer that owns the failure.

References: `packages/host/src/effect/host-errors.ts` and `packages/host/src/domain/task/task-policy-error.ts`.

## Wrap external APIs

Use `Effect.tryPromise` for a Promise API:

```ts
const ensureDirectory = (path: string) =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      toHostOperationError(cause, "localAttachment.ensureDirectory", { path }),
  }).pipe(Effect.asVoid);
```

Use `Effect.try` for a synchronous API that can throw:

```ts
const parsePayload = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => toHostOperationError(cause, "payload.parse"),
  });
```

Use `Effect.sync` for synchronous work that must run inside the Effect runtime. One example is reserving process-local state before a fork.

## Compose steps

Use `Effect.gen` for ordered application steps:

```ts
import { HostPathNotFoundError } from "../effect/host-errors";

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

Use `.pipe(...)` for short transforms:

```ts
Effect.tryPromise({
  try: () => stat(path),
  catch: (cause) => toHostPathStatError(cause, "attachment.exists", path),
}).pipe(
  Effect.as(true),
  Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
);
```

Put the main Effect first. Do not wrap it in deeply nested operators.

```ts
Effect.tryPromise({
  try: () => mkdir(path, { recursive: true }),
  catch: (cause) => toHostOperationError(cause, "dir.ensure", { path }),
}).pipe(Effect.asVoid);
```

Add a named helper when a repeated pattern hides what the code does. Keep one clear use inline.

## Resources and concurrency

- Use `Effect.acquireUseRelease` or a scoped layer for acquire and release.
- Use `Effect.addFinalizer` for cleanup tied to a scope.
- Use `Effect.fork` for a background fiber.
- Join or interrupt each owned fiber during shutdown.
- Use `Deferred` for one-time coordination and single-flight work.
- Use `Ref` for mutable Effect state.
- Use `Schedule` with `Effect.retry` or `Effect.repeat` for a product retry or polling rule.

For single-flight startup, reserve the in-flight slot synchronously before the first yield. Then fork the work and complete a `Deferred` with the full `Exit`. Every caller then gets the same success or failure.

`Deferred.make` and `Effect.fork` can yield. If code sets shared state after either call, two callers can both start the resource.

References: `packages/host/src/adapters/mcp/mcp-host-bridge-server.ts` and `packages/host/src/adapters/runtimes/runtime-registry.ts`.

## Time and streams

Use schedules only when retry, polling, or a loop is part of the product rule.

```ts
Effect.sleep("500 millis");
Schedule.fixed("5 seconds");
```

Use the Effect clock in a program so tests can control time.

Use an Effect stream for SSE, process output, runtime events, watch mode, or subscription state. Bound stream reads in tests. Scope and finalize stream resources. Define backpressure. Convert native events at the transport boundary.

Never collect an infinite stream without `Stream.take`, `takeUntil`, or another bound.

## Tests

Run the Effect at the test boundary:

```ts
await Effect.runPromise(program);
```

Provide a test layer for services:

```ts
const TestSettingsConfig = Layer.succeed(SettingsConfigPortTag, fakeSettingsConfig);

await Effect.runPromise(program.pipe(Effect.provide(TestSettingsConfig)));
```

- Use `TestClock.adjust(...)` for controlled time.
- Use a live clock only when wall time is the subject of the test.
- Use scoped tests for resources with finalizers.
- Interrupt forked fibers during cleanup.
- Use a started latch and a gate for a concurrency test.
- Inside an Effect test program, `yield*` a child Effect. Do not call `Effect.runPromise` again.

## Public boundaries

Convert an Effect result at the edge that owns the caller contract. An IPC handler returns a Promise. An HTTP handler returns a status and body. An SSE handler writes frames. A CLI prints an error and exits with a code.

Do not make an internal service throw only because its outer boundary needs a rejected Promise.

## Migrate a package

1. Name each external boundary such as CLI, HTTP, IPC, SDK, file, process, or transport.
2. Define typed expected failures.
3. Convert I/O ports and services to `Effect.Effect`.
4. Add service tags for replaceable dependencies.
5. Provide live layers at one composition root.
6. Wrap Promise and throwing APIs in adapters.
7. Move cleanup, schedules, and background work to Effect operators.
8. Keep pure policy synchronous.
9. Convert to Promise only at a public boundary.
10. Test failures, replacement, cleanup, and relevant concurrency.

The migration is complete when one full path uses Effect from its public adapter boundary through the service and back. Do not leave Promise orchestration in the middle.

## Review checklist

- I/O and expected failures use `Effect.Effect`.
- Expected failures have tagged types.
- Adapters wrap Promise APIs once.
- Public Promise boundaries are clear.
- Services depend on ports.
- Layers make app dependency setup visible.
- Recovery and retries match a product rule.
- Cleanup runs on success, failure, and interruption.
- Every background fiber has an owner.
- Single-flight state changes before the first yield.
- Pure code stays synchronous.
- Tests control time, streams, fibers, and scopes.

Current examples are in `packages/host/src/ports/*`, `packages/host/src/effect/host-errors.ts`, `packages/host/src/adapters/attachments/local-attachment-adapter.ts`, `packages/host/src/composition/node/node-host-default-ports.ts`, `packages/host/src/interface/router/*`, `packages/host/src/composition/host-lifecycle.ts`, `packages/host/src/adapters/runtimes/runtime-registry.ts`, and `packages/host/src/adapters/mcp/mcp-host-bridge-server.ts`.
