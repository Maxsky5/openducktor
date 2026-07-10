import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Deferred, Effect, FiberId } from "effect";
import { runtimeWorkspaceKey } from "../../domain/runtime-workspace-key";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  RuntimeRegistryError,
  RuntimeRegistryPort,
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import { probeCodexMcpStatus, probeOpenCodeMcpStatus } from "./runtime-registry-probes";
import {
  createRuntimeRegistryStore,
  type WorkspaceRuntimeLookupInput,
} from "./runtime-registry-store";
import {
  createRuntimeSessionOperations,
  probeRuntimeSessionStatus,
  type RuntimeSessionOperationsByKind,
  stopRuntimeSession,
} from "./runtime-session-operations";
export type CreateRuntimeRegistryInput = {
  runtimes?: RuntimeInstanceSummary[];
  workspaceStarter?: RuntimeWorkspaceStarterPort;
  sessionOperations?: RuntimeSessionOperationsByKind;
};

type RuntimeEnsureFlight = {
  cancel: Deferred.Deferred<void>;
  deferred: Deferred.Deferred<RuntimeInstanceSummary, RuntimeRegistryError>;
};

export const createRuntimeRegistry = ({
  runtimes = [],
  workspaceStarter,
  sessionOperations = createRuntimeSessionOperations(),
}: CreateRuntimeRegistryInput = {}): RuntimeRegistryPort => {
  const store = createRuntimeRegistryStore(runtimes);
  const handles = new Map<string, RuntimeWorkspaceHandle>();
  const ensureFlights = new Map<string, RuntimeEnsureFlight>();
  const findRegisteredWorkspaceRuntime = (input: WorkspaceRuntimeLookupInput) =>
    store.findWorkspaceRuntime(input);
  const requireWorkspaceRuntime = (input: WorkspaceRuntimeLookupInput, operation: string) =>
    findRegisteredWorkspaceRuntime(input).pipe(
      Effect.flatMap((runtime) => {
        if (runtime) {
          return Effect.succeed(runtime);
        }
        return Effect.fail(
          new HostResourceError({
            resource: "runtime",
            operation,
            message: `No live ${input.runtimeKind} workspace runtime found for repo '${input.repoPath}'.`,
            details: {
              runtimeKind: input.runtimeKind,
              repoPath: input.repoPath,
            },
          }),
        );
      }),
    );
  const stopRegisteredRuntime = (runtimeId: string) =>
    Effect.gen(function* () {
      const runtime = store.get(runtimeId);
      if (!runtime) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "runtime",
            operation: "runtimeRegistry.stopRuntime",
            message: `Runtime not found: ${runtimeId}`,
            details: { runtimeId },
          }),
        );
      }
      const handle = handles.get(runtimeId);
      if (handle) {
        yield* handle.stop();
        handles.delete(runtimeId);
      }
      store.remove(runtimeId);
      return runtime;
    });
  const cancelStartingRuntimes = () => {
    const flights = [...ensureFlights.values()];
    if (flights.length === 0) {
      return Effect.succeed(undefined);
    }
    return Effect.gen(function* () {
      yield* Effect.forEach(flights, (flight) => Deferred.succeed(flight.cancel, undefined), {
        concurrency: "unbounded",
        discard: true,
      });
      yield* Effect.forEach(flights, (flight) => Effect.exit(Deferred.await(flight.deferred)), {
        concurrency: "unbounded",
        discard: true,
      });
    });
  };
  const makeRuntimeEnsureFlight = (): RuntimeEnsureFlight => ({
    cancel: Deferred.unsafeMake(FiberId.none),
    deferred: Deferred.unsafeMake(FiberId.none),
  });
  const completeRuntimeEnsureFlight = (
    flightKey: string,
    flight: RuntimeEnsureFlight,
    startEffect: Effect.Effect<RuntimeInstanceSummary, RuntimeRegistryError>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.raceFirst(
          startEffect,
          Deferred.await(flight.cancel).pipe(Effect.zipRight(Effect.interrupt)),
        ),
      );
      yield* Deferred.done(flight.deferred, exit);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (ensureFlights.get(flightKey) === flight) {
            ensureFlights.delete(flightKey);
          }
        }),
      ),
    );
  const registry: RuntimeRegistryPort = {
    ensureWorkspaceRuntime(input) {
      return Effect.gen(function* () {
        const existingRuntime = yield* findRegisteredWorkspaceRuntime({
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
        });
        if (existingRuntime) {
          const existingHandle = handles.get(existingRuntime.runtimeId);
          if (existingHandle && !existingHandle.isAlive()) {
            yield* stopRegisteredRuntime(existingRuntime.runtimeId);
          } else {
            const registeredRuntime = store.get(existingRuntime.runtimeId);
            if (registeredRuntime) {
              return yield* Effect.try({
                try: () => runtimeInstanceSummarySchema.parse(registeredRuntime),
                catch: (cause) =>
                  new HostValidationError({
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause,
                    details: {
                      runtimeId: registeredRuntime.runtimeId,
                    },
                  }),
              });
            }
          }
        }
        if (!workspaceStarter) {
          return yield* Effect.fail(
            new HostResourceError({
              resource: "runtimeWorkspaceStarter",
              operation: "runtimeRegistry.ensureWorkspaceRuntime",
              message: `Runtime kind ${input.runtimeKind} workspace startup is not configured in the TypeScript host.`,
              details: {
                runtimeKind: input.runtimeKind,
                repoPath: input.repoPath,
              },
            }),
          );
        }
        const flightKey = runtimeWorkspaceKey({
          runtimeKind: input.runtimeKind,
          repoPath: input.repoPath,
        });
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const reservation = yield* Effect.sync(() => {
              const existingFlight = ensureFlights.get(flightKey);
              if (existingFlight) {
                return { _tag: "existing" as const, flight: existingFlight };
              }
              const flight = makeRuntimeEnsureFlight();
              ensureFlights.set(flightKey, flight);
              return { _tag: "created" as const, flight };
            });
            if (reservation._tag === "existing") {
              return yield* restore(Deferred.await(reservation.flight.deferred));
            }
            const startEffect = Effect.gen(function* () {
              const handle = yield* workspaceStarter.startWorkspaceRuntime(input);
              const parsed = yield* Effect.try({
                try: () => runtimeInstanceSummarySchema.parse(handle.runtime),
                catch: (cause) =>
                  new HostValidationError({
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause,
                    details: {
                      runtimeKind: input.runtimeKind,
                      repoPath: input.repoPath,
                    },
                  }),
              });
              store.upsert(parsed);
              handles.set(parsed.runtimeId, handle);
              return parsed;
            });
            yield* Effect.forkDaemon(
              restore(completeRuntimeEnsureFlight(flightKey, reservation.flight, startEffect)),
            );
            return yield* restore(Deferred.await(reservation.flight.deferred));
          }),
        );
      });
    },
    listRuntimes() {
      return Effect.succeed(store.list());
    },
    findRuntimeById(runtimeId) {
      return Effect.succeed(store.get(runtimeId));
    },
    findWorkspaceRuntime(input) {
      return findRegisteredWorkspaceRuntime(input);
    },
    listRuntimesByRepo(input) {
      return Effect.sync(() => store.listByRepo(input));
    },
    stopRuntime(runtimeId) {
      return Effect.as(stopRegisteredRuntime(runtimeId), true);
    },
    stopAllRuntimes() {
      return Effect.gen(function* () {
        yield* cancelStartingRuntimes();
        const stopped: RuntimeInstanceSummary[] = [];
        const errors: string[] = [];
        for (const runtime of store.list()) {
          const exit = yield* Effect.exit(stopRegisteredRuntime(runtime.runtimeId));
          if (exit._tag === "Success") {
            stopped.push(exit.value);
          } else {
            const message = `${exit.cause}`;
            errors.push(`Failed stopping runtime ${runtime.runtimeId}: ${message}`);
          }
        }
        if (errors.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "runtimeRegistry.stopAllRuntimes",
              message: errors.join("\n"),
              details: { failures: errors },
            }),
          );
        }
        return stopped;
      });
    },
    stopSession(input) {
      return Effect.gen(function* () {
        const runtime = yield* requireWorkspaceRuntime(input, "runtimeRegistry.stopSession");
        return yield* stopRuntimeSession({ input, runtime, sessionOperations });
      });
    },
    probeSessionStatus(input) {
      return Effect.gen(function* () {
        const runtime = yield* findRegisteredWorkspaceRuntime(input);
        return yield* probeRuntimeSessionStatus({
          input,
          runtime,
          sessionOperations,
        });
      });
    },
    probeMcpStatus(input) {
      if (input.runtimeKind === "opencode") {
        return probeOpenCodeMcpStatus(input);
      }
      if (input.runtimeKind === "codex") {
        return Effect.succeed(probeCodexMcpStatus(input));
      }
      return Effect.succeed({
        supported: false,
        connected: false,
        serverStatus: null,
        toolIds: [],
        detail: null,
        failureKind: null,
      });
    },
  };
  return registry;
};
