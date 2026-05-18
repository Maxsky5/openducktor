import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Deferred, Effect, FiberId } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { CodexAppServerPort } from "../../ports/codex-app-server-port";
import type {
  RuntimeRegistryError,
  RuntimeRegistryPort,
  RuntimeWorkspaceHandle,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import { probeCodexSessionStatus } from "../codex/codex-session-status-probe";
import {
  findWorkspaceRuntime,
  probeCodexMcpStatus,
  probeOpenCodeMcpStatus,
  probeOpenCodeSessionStatus,
  runtimeEnsureFlightKey,
  stopOpenCodeSession,
} from "./runtime-registry-probes";
export type CreateRuntimeRegistryInput = {
  runtimes?: RuntimeInstanceSummary[];
  workspaceStarter?: RuntimeWorkspaceStarterPort;
  codexAppServer?: Pick<CodexAppServerPort, "listLoadedThreads" | "listThreads">;
};

type RuntimeEnsureFlight = {
  deferred: Deferred.Deferred<RuntimeInstanceSummary, RuntimeRegistryError>;
};

export const createRuntimeRegistry = ({
  runtimes = [],
  workspaceStarter,
  codexAppServer,
}: CreateRuntimeRegistryInput = {}): RuntimeRegistryPort => {
  const entries = new Map(runtimes.map((runtime) => [runtime.runtimeId, runtime]));
  const handles = new Map<string, RuntimeWorkspaceHandle>();
  const ensureFlights = new Map<string, RuntimeEnsureFlight>();
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
      entries.delete(runtimeId);
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
              entries.set(parsed.runtimeId, parsed);
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
      if (input.runtimeKind === "opencode") {
        return stopOpenCodeSession(input);
      }
      return Effect.fail(
        new HostValidationError({
          message: `Runtime kind ${input.runtimeKind} does not support session stop in the TypeScript host.`,
          field: "runtimeKind",
          details: { runtimeKind: input.runtimeKind },
        }),
      );
    },
    probeSessionStatus(input) {
      if (input.runtimeKind === "opencode") {
        return probeOpenCodeSessionStatus(input);
      }
      if (input.runtimeKind === "codex") {
        if (!codexAppServer) {
          return Effect.fail(
            new HostResourceError({
              resource: "codexAppServer",
              operation: "runtimeRegistry.probeSessionStatus",
              message: "Codex session status probing requires the Codex app-server port.",
            }),
          );
        }
        return probeCodexSessionStatus({ ...input, codexAppServer });
      }
      return Effect.succeed({ supported: false, hasLiveSession: false });
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
