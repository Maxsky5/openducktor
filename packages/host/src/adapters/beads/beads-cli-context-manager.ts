import { Cause, Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import type {
  BeadsTaskRepositoryShutdownResult,
  ResolveBeadsCliContext,
  ResolveRawBeadsCliContext,
  ResolveWorkspaceIdForRepoPath,
} from "../../infrastructure/beads/task-store/beads-raw-issue";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import {
  type BeadsCliContext,
  resolveBeadsCliContext,
  type StopSharedDoltServer,
  stopOwnedSharedDoltServer,
} from "./beads-cli-context";
import {
  awaitBeadsCliContextFlight,
  type BeadsCliContextFlight,
  makeBeadsCliContextFlight,
  resolveBeadsCliContextFlight,
} from "./beads-cli-context-flight";
import { createBeadsCliContextRequestResolver } from "./beads-cli-context-request";
import { createBeadsToolPathResolver, createSharedDoltToolPathResolver } from "./beads-tool-paths";

export type CreateBeadsCliContextManagerInput = {
  processEnv?: NodeJS.ProcessEnv;
  resolveCliContext?: ResolveRawBeadsCliContext;
  resolveWorkspaceIdForRepoPath?: ResolveWorkspaceIdForRepoPath;
  stopSharedDoltServer?: StopSharedDoltServer;
  toolDiscovery: ToolDiscoveryPort;
};

export type BeadsCliContextManager = {
  close(): Effect.Effect<BeadsTaskRepositoryShutdownResult, TaskStoreError>;
  resolveCliContext: ResolveBeadsCliContext;
};

export const createBeadsCliContextManager = ({
  processEnv = process.env,
  resolveCliContext = resolveBeadsCliContext,
  resolveWorkspaceIdForRepoPath,
  stopSharedDoltServer = stopOwnedSharedDoltServer,
  toolDiscovery,
}: CreateBeadsCliContextManagerInput): BeadsCliContextManager => {
  const ownedSharedDoltServers = new Map<string, BeadsCliContext["sharedServer"]>();
  const cliContextFlights = new Set<BeadsCliContextFlight>();
  const readyCliContexts = new Map<string, BeadsCliContextFlight>();
  let closing = false;
  const resolveBeadsToolPaths = createBeadsToolPathResolver(toolDiscovery);
  const resolveSharedDoltToolPaths = createSharedDoltToolPathResolver(toolDiscovery);
  const resolveContextRequest = createBeadsCliContextRequestResolver({
    isClosing: () => closing,
    processEnv,
    resolveBeadsToolPaths,
    resolveSharedDoltToolPaths,
    ...(resolveWorkspaceIdForRepoPath === undefined ? {} : { resolveWorkspaceIdForRepoPath }),
  });
  const rememberOwnedContext = (context: BeadsCliContext): BeadsCliContext => {
    if (context.sharedServer?.ownerPid === process.pid) {
      ownedSharedDoltServers.set(context.serverStatePath, context.sharedServer);
    }
    return context;
  };
  const trackCliContextResolution = (
    contextEffect: Effect.Effect<BeadsCliContext, TaskStoreError>,
  ): Effect.Effect<BeadsCliContext, TaskStoreError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const flight = yield* Effect.sync(() => {
          const nextFlight = makeBeadsCliContextFlight();
          cliContextFlights.add(nextFlight);
          return nextFlight;
        });
        yield* Effect.forkDaemon(
          resolveBeadsCliContextFlight({
            flight,
            releaseReservation: Effect.sync(() => cliContextFlights.delete(flight)),
            rememberOwnedContext,
            resolveContext: contextEffect,
          }),
        );
        return yield* restore(awaitBeadsCliContextFlight(flight));
      }),
    );
  const resolveManagedCliContext: ResolveBeadsCliContext = (repoPath, options = {}) =>
    Effect.gen(function* () {
      const request = yield* resolveContextRequest(repoPath, options);
      if (request.options.requireSharedServer !== true) {
        return yield* trackCliContextResolution(
          resolveCliContext(request.repoPath, request.options),
        );
      }
      const sharedServerOptions = request.options;
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const reservation = yield* Effect.sync(() => {
            const cached = readyCliContexts.get(request.cacheKey);
            if (cached) {
              return { _tag: "existing" as const, flight: cached };
            }
            const flight = makeBeadsCliContextFlight();
            cliContextFlights.add(flight);
            readyCliContexts.set(request.cacheKey, flight);
            return { _tag: "created" as const, flight };
          });
          if (reservation._tag === "existing") {
            return yield* restore(awaitBeadsCliContextFlight(reservation.flight));
          }
          yield* Effect.forkDaemon(
            resolveBeadsCliContextFlight({
              evictCachedContext: Effect.sync(() => {
                if (readyCliContexts.get(request.cacheKey) === reservation.flight) {
                  readyCliContexts.delete(request.cacheKey);
                }
              }),
              flight: reservation.flight,
              releaseReservation: Effect.sync(() => cliContextFlights.delete(reservation.flight)),
              rememberOwnedContext,
              resolveContext: resolveCliContext(request.repoPath, sharedServerOptions),
            }),
          );
          return yield* restore(awaitBeadsCliContextFlight(reservation.flight));
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "beadsCliContextManager.resolveCliContext", {
          repoPath,
          requireSharedServer: options.requireSharedServer === true,
        }),
      ),
    );

  return {
    resolveCliContext: resolveManagedCliContext,
    close() {
      return Effect.gen(function* () {
        closing = true;
        yield* Effect.forEach(
          [...cliContextFlights],
          (flight) => Effect.either(awaitBeadsCliContextFlight(flight)),
          { concurrency: "unbounded" },
        );
        const errors: string[] = [];
        let stoppedSharedDoltServers = 0;
        for (const [serverStatePath, sharedServer] of ownedSharedDoltServers) {
          if (!sharedServer) {
            continue;
          }
          const stopResult = yield* Effect.exit(
            stopSharedDoltServer(sharedServer, serverStatePath),
          );
          if (stopResult._tag === "Success") {
            stoppedSharedDoltServers += 1;
            ownedSharedDoltServers.delete(serverStatePath);
          } else {
            const message = Cause.pretty(stopResult.cause);
            errors.push(`Failed stopping shared Dolt server ${sharedServer.pid}: ${message}`);
          }
        }
        if (errors.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "beadsCliContextManager.close",
              message: errors.join("\n"),
              details: { failures: errors },
            }),
          );
        }
        return { stoppedSharedDoltServers };
      });
    },
  };
};
