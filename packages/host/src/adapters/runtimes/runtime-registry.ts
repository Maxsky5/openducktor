import {
  type RuntimeInstanceSummary,
  type RuntimeRoute,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Deferred, Effect, FiberId } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeRegistryError,
  RuntimeRegistryPort,
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import { probeCodexSessionStatus } from "../codex/codex-session-status-probe";
import { stopCodexSession } from "../codex/codex-session-stop";
import {
  probeCodexMcpStatus,
  probeOpenCodeMcpStatus,
  probeOpenCodeSessionStatus,
  runtimeEnsureFlightKey,
  stopOpenCodeSession,
} from "./runtime-registry-probes";
export type CreateRuntimeRegistryInput = {
  runtimes?: RuntimeInstanceSummary[];
  workspaceStarter?: RuntimeWorkspaceStarterPort;
  codexAppServer?: Pick<CodexAppServerPort, "request">;
};

type RuntimeEnsureFlight = {
  deferred: Deferred.Deferred<RuntimeInstanceSummary, RuntimeRegistryError>;
};

type RuntimeSessionTargetInput = {
  runtimeKind: string;
  repoPath: string;
};

const findWorkspaceRuntime = (
  runtimes: Iterable<RuntimeInstanceSummary>,
  input: RuntimeEnsureWorkspaceInput,
): RuntimeInstanceSummary | undefined => {
  for (const runtime of runtimes) {
    if (
      runtime.kind === input.runtimeKind &&
      runtime.repoPath === input.repoPath &&
      runtime.role === "workspace"
    ) {
      return runtime;
    }
  }
  return undefined;
};

const requireCodexRuntimeId = (runtimeRoute: RuntimeRoute) =>
  Effect.gen(function* () {
    if (runtimeRoute.type === "stdio") {
      return runtimeRoute.identity;
    }
    return yield* Effect.fail(
      new HostValidationError({
        field: "runtimeRoute",
        message: "Codex app-server operations require a stdio runtime route.",
        details: { runtimeRouteType: runtimeRoute.type },
      }),
    );
  });

export const createRuntimeRegistry = ({
  runtimes = [],
  workspaceStarter,
  codexAppServer,
}: CreateRuntimeRegistryInput = {}): RuntimeRegistryPort => {
  const entries = new Map<string, RuntimeInstanceSummary>();
  const runtimeIdsByRepo = new Map<string, Set<string>>();
  const handles = new Map<string, RuntimeWorkspaceHandle>();
  const ensureFlights = new Map<string, RuntimeEnsureFlight>();
  const repoIndexKey = (repoPath: string): string => normalizePathForComparison(repoPath);
  const addRuntimeToIndexes = (runtime: RuntimeInstanceSummary) => {
    const key = repoIndexKey(runtime.repoPath);
    const ids = runtimeIdsByRepo.get(key) ?? new Set<string>();
    ids.add(runtime.runtimeId);
    runtimeIdsByRepo.set(key, ids);
  };
  const removeRuntimeFromIndexes = (runtime: RuntimeInstanceSummary) => {
    const key = repoIndexKey(runtime.repoPath);
    const ids = runtimeIdsByRepo.get(key);
    if (!ids) {
      return;
    }
    ids.delete(runtime.runtimeId);
    if (ids.size === 0) {
      runtimeIdsByRepo.delete(key);
    }
  };
  const upsertRuntime = (runtime: RuntimeInstanceSummary) => {
    const previous = entries.get(runtime.runtimeId);
    if (previous) {
      removeRuntimeFromIndexes(previous);
    }
    entries.set(runtime.runtimeId, runtime);
    addRuntimeToIndexes(runtime);
  };
  const removeRuntime = (runtimeId: string): RuntimeInstanceSummary | null => {
    const runtime = entries.get(runtimeId);
    if (!runtime) {
      return null;
    }
    removeRuntimeFromIndexes(runtime);
    entries.delete(runtimeId);
    return runtime;
  };
  const readRuntimesForRepo = ({
    repoPath,
    runtimeKind,
  }: {
    repoPath: string;
    runtimeKind?: string;
  }): RuntimeInstanceSummary[] => {
    const ids = runtimeIdsByRepo.get(repoIndexKey(repoPath));
    if (!ids) {
      return [];
    }
    const result: RuntimeInstanceSummary[] = [];
    for (const runtimeId of ids) {
      const runtime = entries.get(runtimeId);
      if (!runtime) {
        throw new Error(`Runtime registry repo index referenced missing runtime: ${runtimeId}`);
      }
      if (runtimeKind && runtime.kind !== runtimeKind) {
        continue;
      }
      result.push(runtime);
    }
    return result;
  };
  const findWorkspaceSessionRuntime = (input: RuntimeSessionTargetInput) =>
    Effect.gen(function* () {
      const runtimes = readRuntimesForRepo({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      }).filter(
        (runtime) =>
          runtime.kind === input.runtimeKind &&
          runtime.role === "workspace" &&
          runtime.taskId === null,
      );
      if (runtimes.length === 0) {
        return null;
      }
      if (runtimes.length > 1) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "runtimeRegistry.resolveWorkspaceSessionRuntime",
            message: `Multiple live ${input.runtimeKind} workspace runtimes found for repo '${input.repoPath}'.`,
            details: { runtimeKind: input.runtimeKind, repoPath: input.repoPath },
          }),
        );
      }
      return runtimes[0] ?? null;
    });
  const requireWorkspaceSessionRuntime = (input: RuntimeSessionTargetInput, operation: string) =>
    findWorkspaceSessionRuntime(input).pipe(
      Effect.flatMap((runtime) => {
        if (runtime) {
          return Effect.succeed(runtime);
        }
        return Effect.fail(
          new HostResourceError({
            resource: "runtime",
            operation,
            message: `No live ${input.runtimeKind} workspace runtime found for repo '${input.repoPath}'.`,
            details: { runtimeKind: input.runtimeKind, repoPath: input.repoPath },
          }),
        );
      }),
    );
  for (const runtime of runtimes) {
    upsertRuntime(runtime);
  }
  const stopRegisteredRuntime = (runtimeId: string) =>
    Effect.gen(function* () {
      const runtime = entries.get(runtimeId);
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
      removeRuntime(runtimeId);
      return runtime;
    });
  const waitForStartingRuntimes = () => {
    const flights = [...ensureFlights.values()];
    if (flights.length === 0) {
      return Effect.succeed(undefined);
    }
    return Effect.forEach(flights, (flight) => Effect.either(Deferred.await(flight.deferred)), {
      concurrency: "unbounded",
    }).pipe(Effect.asVoid);
  };
  const makeRuntimeEnsureFlight = (): RuntimeEnsureFlight => ({
    deferred: Deferred.unsafeMake(FiberId.none),
  });
  const completeRuntimeEnsureFlight = (
    flightKey: string,
    flight: RuntimeEnsureFlight,
    startEffect: Effect.Effect<RuntimeInstanceSummary, RuntimeRegistryError>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(startEffect);
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
        const existingRuntime = findWorkspaceRuntime(entries.values(), input);
        if (existingRuntime) {
          return yield* Effect.try({
            try: () => runtimeInstanceSummarySchema.parse(existingRuntime),
            catch: (cause) =>
              new HostValidationError({
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
                details: {
                  runtimeId: existingRuntime.runtimeId,
                },
              }),
          });
        }
        if (!workspaceStarter) {
          return yield* Effect.fail(
            new HostResourceError({
              resource: "runtimeWorkspaceStarter",
              operation: "runtimeRegistry.ensureWorkspaceRuntime",
              message: `Runtime kind ${input.runtimeKind} workspace startup is not configured in the TypeScript host.`,
              details: { runtimeKind: input.runtimeKind, repoPath: input.repoPath },
            }),
          );
        }
        const flightKey = runtimeEnsureFlightKey(input.runtimeKind, input.repoPath);
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
                    details: { runtimeKind: input.runtimeKind, repoPath: input.repoPath },
                  }),
              });
              upsertRuntime(parsed);
              handles.set(parsed.runtimeId, handle);
              return parsed;
            });
            yield* Effect.forkDaemon(
              completeRuntimeEnsureFlight(flightKey, reservation.flight, startEffect),
            );
            return yield* restore(Deferred.await(reservation.flight.deferred));
          }),
        );
      });
    },
    listRuntimes() {
      return Effect.succeed([...entries.values()]);
    },
    findRuntimeById(runtimeId) {
      return Effect.succeed(entries.get(runtimeId) ?? null);
    },
    listRuntimesByRepo(input) {
      return Effect.sync(() => readRuntimesForRepo(input));
    },
    stopRuntime(runtimeId) {
      return Effect.as(stopRegisteredRuntime(runtimeId), true);
    },
    stopAllRuntimes() {
      return Effect.gen(function* () {
        yield* waitForStartingRuntimes();
        const stopped: RuntimeInstanceSummary[] = [];
        const errors: string[] = [];
        for (const runtime of [...entries.values()]) {
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
        const runtime = yield* requireWorkspaceSessionRuntime(input, "runtimeRegistry.stopSession");
        const target = {
          runtimeKind: input.runtimeKind,
          runtimeRoute: runtime.runtimeRoute,
          externalSessionId: input.externalSessionId,
          workingDirectory: input.workingDirectory,
        };
        if (input.runtimeKind === "opencode") {
          return yield* stopOpenCodeSession(target);
        }
        if (input.runtimeKind === "codex") {
          if (!codexAppServer) {
            return yield* Effect.fail(
              new HostResourceError({
                resource: "codexAppServer",
                operation: "runtimeRegistry.stopCodexSession",
                message: "Codex session stop requires the Codex app-server port.",
              }),
            );
          }
          const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
          return yield* stopCodexSession({
            codexAppServer,
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          });
        }
        return yield* Effect.fail(
          new HostValidationError({
            message: `Runtime kind ${input.runtimeKind} does not support session stop in the TypeScript host.`,
            field: "runtimeKind",
            details: { runtimeKind: input.runtimeKind },
          }),
        );
      });
    },
    probeSessionStatus(input) {
      return Effect.gen(function* () {
        const runtime = yield* findWorkspaceSessionRuntime(input);
        if (!runtime) {
          return { supported: true, hasLiveSession: false };
        }
        const target = {
          runtimeKind: input.runtimeKind,
          runtimeRoute: runtime.runtimeRoute,
          externalSessionId: input.externalSessionId,
          workingDirectory: input.workingDirectory,
        };
        if (input.runtimeKind === "opencode") {
          return yield* probeOpenCodeSessionStatus(target);
        }
        if (input.runtimeKind === "codex") {
          if (!codexAppServer) {
            return yield* Effect.fail(
              new HostResourceError({
                resource: "codexAppServer",
                operation: "runtimeRegistry.probeSessionStatus",
                message: "Codex session status probing requires the Codex app-server port.",
              }),
            );
          }
          const runtimeId = yield* requireCodexRuntimeId(runtime.runtimeRoute);
          return yield* probeCodexSessionStatus({
            codexAppServer,
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          });
        }
        return { supported: false, hasLiveSession: false };
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
