import { Cause, Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";
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

type BeadsCliContextFlightReservation =
  | { _tag: "existing"; flight: BeadsCliContextFlight }
  | { _tag: "created"; flight: BeadsCliContextFlight };

const createTrackedCliContextFlight = (
  cliContextFlights: Set<BeadsCliContextFlight>,
): BeadsCliContextFlight => {
  const flight = makeBeadsCliContextFlight();
  cliContextFlights.add(flight);
  return flight;
};

const reserveReadyCliContextFlight = ({
  cacheKey,
  cliContextFlights,
  readyCliContexts,
}: {
  cacheKey: string;
  cliContextFlights: Set<BeadsCliContextFlight>;
  readyCliContexts: Map<string, BeadsCliContextFlight>;
}): BeadsCliContextFlightReservation => {
  const cached = readyCliContexts.get(cacheKey);
  if (cached) {
    return { _tag: "existing", flight: cached };
  }
  const flight = createTrackedCliContextFlight(cliContextFlights);
  readyCliContexts.set(cacheKey, flight);
  return { _tag: "created", flight };
};

const forkCliContextFlightResolution = ({
  cliContextFlights,
  evictCachedContext,
  flight,
  rememberOwnedContext,
  resolveContext,
}: {
  cliContextFlights: Set<BeadsCliContextFlight>;
  evictCachedContext?: Effect.Effect<void>;
  flight: BeadsCliContextFlight;
  rememberOwnedContext: (context: BeadsCliContext) => BeadsCliContext;
  resolveContext: Effect.Effect<BeadsCliContext, TaskStoreError>;
}): Effect.Effect<void> =>
  Effect.forkDaemon(
    resolveBeadsCliContextFlight({
      ...(evictCachedContext === undefined ? {} : { evictCachedContext }),
      flight,
      releaseReservation: Effect.sync(() => cliContextFlights.delete(flight)),
      rememberOwnedContext,
      resolveContext,
    }),
  ).pipe(Effect.asVoid);

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
  const closingError = () =>
    new HostResourceError({
      resource: "beadsTaskStore",
      operation: "beadsCliContextManager.resolveCliContext",
      message: "Beads task store is closing.",
    });
  const reserveTrackedCliContextFlight = (): Effect.Effect<BeadsCliContextFlight, TaskStoreError> =>
    Effect.suspend(() =>
      closing
        ? Effect.fail(closingError())
        : Effect.succeed(createTrackedCliContextFlight(cliContextFlights)),
    );
  const reserveReadyCliContextFlightIfOpen = (
    cacheKey: string,
  ): Effect.Effect<BeadsCliContextFlightReservation, TaskStoreError> =>
    Effect.suspend(() =>
      closing
        ? Effect.fail(closingError())
        : Effect.succeed(
            reserveReadyCliContextFlight({
              cacheKey,
              cliContextFlights,
              readyCliContexts,
            }),
          ),
    );
  const resolveBeadsToolPaths = createBeadsToolPathResolver(toolDiscovery);
  const resolveSharedDoltToolPaths = createSharedDoltToolPathResolver(toolDiscovery, processEnv);
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
    resolveContext: () => Effect.Effect<BeadsCliContext, TaskStoreError>,
  ): Effect.Effect<BeadsCliContext, TaskStoreError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const flight = yield* reserveTrackedCliContextFlight();
        yield* forkCliContextFlightResolution({
          cliContextFlights,
          flight,
          rememberOwnedContext,
          resolveContext: resolveContext(),
        });
        return yield* restore(awaitBeadsCliContextFlight(flight));
      }),
    );
  const resolveManagedCliContext: ResolveBeadsCliContext = (repoPath, options = {}) =>
    Effect.gen(function* () {
      const request = yield* resolveContextRequest(repoPath, options);
      if (request.options.requireSharedServer !== true) {
        const optionalServerOptions = request.options;
        return yield* trackCliContextResolution(() =>
          resolveCliContext(request.repoPath, optionalServerOptions),
        );
      }
      const sharedServerOptions = request.options;
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const reservation = yield* reserveReadyCliContextFlightIfOpen(request.cacheKey);
          if (reservation._tag === "existing") {
            return yield* restore(awaitBeadsCliContextFlight(reservation.flight));
          }
          yield* forkCliContextFlightResolution({
            cliContextFlights,
            evictCachedContext: Effect.sync(() => {
              if (readyCliContexts.get(request.cacheKey) === reservation.flight) {
                readyCliContexts.delete(request.cacheKey);
              }
            }),
            flight: reservation.flight,
            rememberOwnedContext,
            resolveContext: resolveCliContext(request.repoPath, sharedServerOptions),
          });
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
