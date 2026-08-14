import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import { ensureSchema } from "./sqlite-task-store-migrations";
import { type TaskStoreSession, taskStoreSchema } from "./sqlite-task-store-schema";

export type ResolveWorkspaceIdForRepoPath = (
  repoPath: string,
) => Effect.Effect<string, TaskStoreError>;

export type ResolveSqliteTaskStorePath = (input: {
  repoPath: string;
  workspaceId: string;
}) => Effect.Effect<string, TaskStoreError>;

export type SqliteTaskRepositoryContext = {
  databasePath: string;
  repoPath: string;
  session: TaskStoreSession;
  workspaceId: string;
};

export type SqliteTaskRepositoryContextProvider = <A>(
  repoPath: string,
  operation: string,
  use: (context: SqliteTaskRepositoryContext) => Effect.Effect<A, unknown>,
) => Effect.Effect<A, TaskStoreError>;

export type SqliteTaskRepositoryContextManager = {
  readonly dispose: () => Effect.Effect<void, HostOperationError>;
  readonly withDatabase: SqliteTaskRepositoryContextProvider;
};

type CreateSqliteTaskRepositoryContextManagerInput = {
  onBackgroundFailure?: (failure: HostOperationError) => Effect.Effect<void, never>;
  processEnv: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

type SqliteTaskRepositoryStorage = {
  databasePath: string;
  repoPath: string;
  workspaceId: string;
};

type ManagedSqliteTaskStoreConnection = {
  close: Effect.Effect<void, HostOperationError>;
  operationSemaphore: Effect.Semaphore;
  scope: Scope.CloseableScope;
  session: TaskStoreSession;
};

type ConnectionFlight = Deferred.Deferred<ManagedSqliteTaskStoreConnection, TaskStoreError>;
type CloseFlight = Deferred.Deferred<void, HostOperationError>;

const SQLITE_TASK_STORE_IDLE_TIMEOUT = "5 minutes";

const resolveDefaultDatabasePath =
  (processEnv: NodeJS.ProcessEnv): ResolveSqliteTaskStorePath =>
  ({ workspaceId }) =>
    resolveSqliteTaskStoreDatabasePath({
      configDir: resolveOpenDucktorBaseDir(processEnv),
      workspaceId,
    });

const hostIsStoppingError = () =>
  new HostOperationError({
    operation: "sqliteTaskRepository.acquireConnection",
    message: "The SQLite task store is stopping and cannot accept a new operation.",
  });

export const createSqliteTaskRepositoryContextManager = ({
  onBackgroundFailure = (failure) => Effect.logError(failure.message),
  processEnv,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryContextManagerInput): SqliteTaskRepositoryContextManager => {
  const connectionFlights = new Map<string, ConnectionFlight>();
  const connections = new Map<string, ManagedSqliteTaskStoreConnection>();
  const closingFlights = new Map<string, CloseFlight>();
  const closeFailures = new Map<string, HostOperationError>();
  const demands = new Map<string, number>();
  const idleFibers = new Map<string, Fiber.RuntimeFiber<void, never>>();
  const idleGenerations = new Map<string, number>();
  let accepting = true;
  let totalDemand = 0;
  let shutdownWaiter: Deferred.Deferred<void> | null = null;

  const resolveStorage = (repoPath: string) =>
    Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(repoPath);
      const databasePath = yield* resolveDatabasePath({ repoPath, workspaceId });
      return {
        databasePath,
        repoPath,
        workspaceId,
      } satisfies SqliteTaskRepositoryStorage;
    });

  const openConnection = (storage: SqliteTaskRepositoryStorage) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(storage.databasePath), { recursive: true }),
        catch: (cause) =>
          new HostOperationError({
            operation: "sqliteTaskRepository.createDatabaseDirectory",
            message: errorMessage(cause),
            cause,
            details: { databasePath: storage.databasePath },
          }),
      });
      const scope = yield* Scope.make();
      const openExit = yield* Effect.exit(
        Effect.gen(function* () {
          const connection = yield* openSqliteDrizzleConnection<typeof taskStoreSchema>({
            databasePath: storage.databasePath,
            configureWal: true,
            config: {
              schema: taskStoreSchema,
            },
          }).pipe(Scope.extend(scope));
          yield* ensureSchema(connection.database, connection.session, storage.databasePath);
          const operationSemaphore = yield* Effect.makeSemaphore(1);
          return {
            close: connection.close,
            operationSemaphore,
            scope,
            session: connection.session,
          } satisfies ManagedSqliteTaskStoreConnection;
        }),
      );
      if (Exit.isFailure(openExit)) {
        yield* Scope.close(scope, openExit);
        return yield* Effect.failCause(openExit.cause);
      }
      return openExit.value;
    });

  const completeConnectionFlight = (
    databasePath: string,
    flight: ConnectionFlight,
    open: Effect.Effect<ManagedSqliteTaskStoreConnection, TaskStoreError>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(open);
      if (Exit.isSuccess(exit)) {
        connections.set(databasePath, exit.value);
      }
      yield* Deferred.done(flight, exit);
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
      return exit.value;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (connectionFlights.get(databasePath) === flight) {
            connectionFlights.delete(databasePath);
          }
        }),
      ),
    );

  const acquireConnection = (
    storage: SqliteTaskRepositoryStorage,
  ): Effect.Effect<ManagedSqliteTaskStoreConnection, TaskStoreError> =>
    Effect.suspend(() =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const newFlight = yield* Deferred.make<
            ManagedSqliteTaskStoreConnection,
            TaskStoreError
          >();
          const reservation = yield* Effect.sync(() => {
            const closeFailure = closeFailures.get(storage.databasePath);
            if (closeFailure) return { _tag: "close-failed" as const, failure: closeFailure };
            const closingFlight = closingFlights.get(storage.databasePath);
            if (closingFlight) return { _tag: "closing" as const, flight: closingFlight };
            const connection = connections.get(storage.databasePath);
            if (connection) {
              return { _tag: "ready" as const, connection };
            }
            const existingFlight = connectionFlights.get(storage.databasePath);
            if (existingFlight) {
              return { _tag: "opening" as const, flight: existingFlight };
            }
            connectionFlights.set(storage.databasePath, newFlight);
            return { _tag: "created" as const, flight: newFlight };
          });

          if (reservation._tag === "close-failed") {
            return yield* reservation.failure;
          }
          if (reservation._tag === "closing") {
            yield* restore(Deferred.await(reservation.flight));
            return yield* acquireConnection(storage);
          }
          if (reservation._tag === "ready") {
            return reservation.connection;
          }
          if (reservation._tag === "opening") {
            return yield* restore(Deferred.await(reservation.flight));
          }
          return yield* completeConnectionFlight(
            storage.databasePath,
            reservation.flight,
            openConnection(storage),
          );
        }),
      ),
    );

  const closeManagedConnection = (
    databasePath: string,
    connection: ManagedSqliteTaskStoreConnection,
    closeFlight: CloseFlight,
  ): Effect.Effect<void, HostOperationError> =>
    Effect.gen(function* () {
      const closeResult = yield* Effect.either(connection.close);
      yield* Scope.close(connection.scope, Exit.void);
      if (closeResult._tag === "Left") {
        closeFailures.set(databasePath, closeResult.left);
        yield* Deferred.fail(closeFlight, closeResult.left);
        return yield* closeResult.left;
      }
      yield* Deferred.succeed(closeFlight, undefined);
      if (closingFlights.get(databasePath) === closeFlight) {
        closingFlights.delete(databasePath);
      }
    });

  const closeIdleConnection = (databasePath: string, generation: number) =>
    Effect.gen(function* () {
      const closeFlight = yield* Deferred.make<void, HostOperationError>();
      const reservation = yield* Effect.sync(() => {
        const connection = connections.get(databasePath);
        if (
          !accepting ||
          !connection ||
          (demands.get(databasePath) ?? 0) !== 0 ||
          idleGenerations.get(databasePath) !== generation
        ) {
          return null;
        }
        connections.delete(databasePath);
        idleFibers.delete(databasePath);
        closingFlights.set(databasePath, closeFlight);
        return connection;
      });
      if (!reservation) return;
      yield* closeManagedConnection(databasePath, reservation, closeFlight);
    });

  const scheduleIdleClose = (databasePath: string) =>
    Effect.gen(function* () {
      const generation = yield* Effect.sync(() => {
        const next = (idleGenerations.get(databasePath) ?? 0) + 1;
        idleGenerations.set(databasePath, next);
        return next;
      });
      const fiber = yield* Effect.forkDaemon(
        Effect.sleep(SQLITE_TASK_STORE_IDLE_TIMEOUT).pipe(
          Effect.zipRight(closeIdleConnection(databasePath, generation)),
          Effect.catchAll(onBackgroundFailure),
        ),
      );
      const keepFiber = yield* Effect.sync(() => {
        if (
          accepting &&
          (demands.get(databasePath) ?? 0) === 0 &&
          idleGenerations.get(databasePath) === generation
        ) {
          idleFibers.set(databasePath, fiber);
          return true;
        }
        return false;
      });
      if (!keepFiber) {
        yield* Fiber.interruptFork(fiber);
      }
    });

  const reserveDemand = (databasePath: string) =>
    Effect.gen(function* () {
      const reservation = yield* Effect.sync(() => {
        if (!accepting) return { _tag: "stopping" as const };
        totalDemand += 1;
        demands.set(databasePath, (demands.get(databasePath) ?? 0) + 1);
        idleGenerations.set(databasePath, (idleGenerations.get(databasePath) ?? 0) + 1);
        const idleFiber = idleFibers.get(databasePath) ?? null;
        idleFibers.delete(databasePath);
        return { _tag: "reserved" as const, idleFiber };
      });
      if (reservation._tag === "stopping") {
        return yield* hostIsStoppingError();
      }
      if (reservation.idleFiber) {
        yield* Fiber.interruptFork(reservation.idleFiber);
      }
    });

  const releaseDemand = (databasePath: string) =>
    Effect.gen(function* () {
      const released = yield* Effect.sync(() => {
        const currentDemand = demands.get(databasePath) ?? 0;
        const nextDemand = Math.max(0, currentDemand - 1);
        if (nextDemand === 0) demands.delete(databasePath);
        else demands.set(databasePath, nextDemand);
        totalDemand = Math.max(0, totalDemand - 1);
        return {
          scheduleIdle: accepting && nextDemand === 0 && connections.has(databasePath),
          shutdownWaiter: totalDemand === 0 ? shutdownWaiter : null,
        };
      });
      if (released.scheduleIdle) {
        yield* scheduleIdleClose(databasePath);
      }
      if (released.shutdownWaiter) {
        yield* Deferred.succeed(released.shutdownWaiter, undefined);
      }
    });

  const withDatabase: SqliteTaskRepositoryContextProvider = (repoPath, operation, use) =>
    Effect.gen(function* () {
      const storage = yield* resolveStorage(repoPath);
      const run = Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* reserveDemand(storage.databasePath);
          const acquireExit = yield* Effect.exit(
            Effect.gen(function* () {
              const connection = yield* acquireConnection(storage);
              yield* connection.operationSemaphore.take(1);
              return connection;
            }),
          );
          if (Exit.isFailure(acquireExit)) {
            yield* releaseDemand(storage.databasePath);
            return yield* Effect.failCause(acquireExit.cause);
          }
          return acquireExit.value;
        }),
        (connection) => use({ ...storage, session: connection.session }),
        (connection) =>
          connection.operationSemaphore
            .release(1)
            .pipe(Effect.zipRight(releaseDemand(storage.databasePath))),
      );
      return yield* run.pipe(
        Effect.mapError((cause) =>
          mapSqliteTaskStoreAdapterError(operation, storage.databasePath, cause),
        ),
      );
    });

  const dispose = () =>
    Effect.gen(function* () {
      const waiter = yield* Deferred.make<void>();
      const shutdown = yield* Effect.sync(() => {
        accepting = false;
        shutdownWaiter ??= waiter;
        const fibers = Array.from(idleFibers.values());
        idleFibers.clear();
        for (const databasePath of idleGenerations.keys()) {
          idleGenerations.set(databasePath, (idleGenerations.get(databasePath) ?? 0) + 1);
        }
        return { drained: totalDemand === 0, fibers, waiter: shutdownWaiter };
      });
      yield* Effect.forEach(shutdown.fibers, Fiber.interruptFork, { discard: true });
      if (!shutdown.drained) {
        yield* Deferred.await(shutdown.waiter);
      }
      const flights = Array.from(connectionFlights.values());
      yield* Effect.forEach(flights, (flight) => Deferred.await(flight).pipe(Effect.ignore), {
        discard: true,
      });
      const pendingCloses = Array.from(closingFlights.values());
      yield* Effect.forEach(pendingCloses, (flight) => Deferred.await(flight).pipe(Effect.ignore), {
        discard: true,
      });
      const failures: HostOperationError[] = Array.from(closeFailures.values());
      for (const [databasePath, connection] of connections) {
        const closeFlight = yield* Deferred.make<void, HostOperationError>();
        connections.delete(databasePath);
        closingFlights.set(databasePath, closeFlight);
        const closeResult = yield* Effect.either(
          closeManagedConnection(databasePath, connection, closeFlight),
        );
        if (closeResult._tag === "Left") {
          failures.push(closeResult.left);
        }
      }
      connections.clear();
      if (failures.length > 0) {
        return yield* new HostOperationError({
          operation: "sqliteTaskRepository.disposeConnections",
          message: failures.map((failure) => failure.message).join("\n"),
          cause: failures[0],
          details: { failures },
        });
      }
    });

  return { dispose, withDatabase };
};

export const createSqliteTaskRepositoryContextProvider = (
  input: CreateSqliteTaskRepositoryContextManagerInput,
): SqliteTaskRepositoryContextProvider =>
  createSqliteTaskRepositoryContextManager(input).withDatabase;
