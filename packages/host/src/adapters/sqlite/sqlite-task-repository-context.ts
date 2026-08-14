import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { HostOperationError } from "../../effect/host-errors";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  type ManagedSqliteTaskStoreConnection,
  type OpenSqliteTaskStoreConnection,
  openSqliteTaskStoreConnection,
  type SqliteTaskStoreStorage,
} from "./sqlite-task-store-connection";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { TaskStoreSession } from "./sqlite-task-store-schema";

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
  openConnection?: OpenSqliteTaskStoreConnection;
  processEnv: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

type ConnectionFlight = Deferred.Deferred<ManagedSqliteTaskStoreConnection, TaskStoreError>;
type CloseFlight = Deferred.Deferred<void, HostOperationError>;
type IdleClose = {
  fiber: Fiber.RuntimeFiber<void, never>;
  token: object;
};
type ConnectionEntry = { demand: number } & (
  | { _tag: "vacant" }
  | { _tag: "opening"; flight: ConnectionFlight }
  | {
      _tag: "ready";
      connection: ManagedSqliteTaskStoreConnection;
      idleClose: IdleClose | null;
    }
  | { _tag: "closing"; flight: CloseFlight }
  | { _tag: "failed"; failure: HostOperationError }
);
type ReadyConnectionEntry = Extract<ConnectionEntry, { _tag: "ready" }>;

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

const connectionEntryStateError = (databasePath: string, message: string) =>
  new HostOperationError({
    operation: "sqliteTaskRepository.connectionState",
    message,
    details: { databasePath },
  });

export const createSqliteTaskRepositoryContextManager = ({
  onBackgroundFailure = (failure) => Effect.logError(failure.message),
  openConnection = openSqliteTaskStoreConnection,
  processEnv,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryContextManagerInput): SqliteTaskRepositoryContextManager => {
  const entries = new Map<string, ConnectionEntry>();
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
      } satisfies SqliteTaskStoreStorage;
    });

  const completeConnectionFlight = (
    databasePath: string,
    flight: ConnectionFlight,
    open: Effect.Effect<ManagedSqliteTaskStoreConnection, TaskStoreError>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(open);
      const transitionError = yield* Effect.sync(() => {
        const current = entries.get(databasePath);
        if (current?._tag !== "opening" || current.flight !== flight) {
          return connectionEntryStateError(
            databasePath,
            "The SQLite task store connection changed while it was opening.",
          );
        }
        if (Exit.isSuccess(exit)) {
          entries.set(databasePath, {
            _tag: "ready",
            connection: exit.value,
            demand: current.demand,
            idleClose: null,
          });
        } else if (current.demand === 0) {
          entries.delete(databasePath);
        } else {
          entries.set(databasePath, { _tag: "vacant", demand: current.demand });
        }
        return null;
      });
      if (transitionError) {
        yield* Deferred.fail(flight, transitionError);
        if (Exit.isSuccess(exit)) {
          yield* exit.value.close.pipe(Effect.ignore);
          yield* Scope.close(exit.value.scope, Exit.void);
        }
        return yield* transitionError;
      }
      yield* Deferred.done(flight, exit);
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
      return exit.value;
    });

  const acquireConnection = (
    storage: SqliteTaskStoreStorage,
  ): Effect.Effect<ManagedSqliteTaskStoreConnection, TaskStoreError> =>
    Effect.suspend(() =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const newFlight = yield* Deferred.make<
            ManagedSqliteTaskStoreConnection,
            TaskStoreError
          >();
          const reservation = yield* Effect.sync(() => {
            const current = entries.get(storage.databasePath);
            if (!current) {
              return {
                _tag: "invalid" as const,
                failure: connectionEntryStateError(
                  storage.databasePath,
                  "The SQLite task store connection has no reserved demand.",
                ),
              };
            }
            switch (current._tag) {
              case "failed":
                return { _tag: "failed" as const, failure: current.failure };
              case "closing":
                return { _tag: "closing" as const, flight: current.flight };
              case "ready":
                return { _tag: "ready" as const, connection: current.connection };
              case "opening":
                return { _tag: "opening" as const, flight: current.flight };
              case "vacant":
                entries.set(storage.databasePath, {
                  _tag: "opening",
                  demand: current.demand,
                  flight: newFlight,
                });
                return { _tag: "created" as const, flight: newFlight };
            }
          });

          if (reservation._tag === "invalid" || reservation._tag === "failed") {
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
      const transitionError = yield* Effect.sync(() => {
        const current = entries.get(databasePath);
        if (current?._tag !== "closing" || current.flight !== closeFlight) {
          return connectionEntryStateError(
            databasePath,
            "The SQLite task store connection changed while it was closing.",
          );
        }
        if (closeResult._tag === "Left") {
          entries.set(databasePath, {
            _tag: "failed",
            demand: current.demand,
            failure: closeResult.left,
          });
        } else if (current.demand === 0) {
          entries.delete(databasePath);
        } else {
          entries.set(databasePath, { _tag: "vacant", demand: current.demand });
        }
        return null;
      });
      if (transitionError) {
        yield* Deferred.fail(closeFlight, transitionError);
        return yield* transitionError;
      }
      if (closeResult._tag === "Left") {
        yield* Deferred.fail(closeFlight, closeResult.left);
        return yield* closeResult.left;
      }
      yield* Deferred.succeed(closeFlight, undefined);
    });

  const closeIdleConnection = (databasePath: string, token: object) =>
    Effect.gen(function* () {
      const closeFlight = yield* Deferred.make<void, HostOperationError>();
      const reservation = yield* Effect.sync(() => {
        const current = entries.get(databasePath);
        if (
          !accepting ||
          current?._tag !== "ready" ||
          current.demand !== 0 ||
          current.idleClose?.token !== token
        ) {
          return null;
        }
        entries.set(databasePath, {
          _tag: "closing",
          demand: 0,
          flight: closeFlight,
        });
        return current.connection;
      });
      if (!reservation) return;
      yield* closeManagedConnection(databasePath, reservation, closeFlight);
    });

  const scheduleIdleClose = (databasePath: string, entry: ReadyConnectionEntry) =>
    Effect.gen(function* () {
      const token = {};
      const fiber = yield* Effect.forkDaemon(
        Effect.sleep(SQLITE_TASK_STORE_IDLE_TIMEOUT).pipe(
          Effect.zipRight(closeIdleConnection(databasePath, token)),
          Effect.catchAll(onBackgroundFailure),
        ),
      );
      const keepFiber = yield* Effect.sync(() => {
        const current = entries.get(databasePath);
        if (accepting && current === entry && current.demand === 0) {
          current.idleClose = { fiber, token };
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
        const current = entries.get(databasePath);
        if (!current) {
          entries.set(databasePath, { _tag: "vacant", demand: 1 });
          return { _tag: "reserved" as const, idleFiber: null };
        }
        current.demand += 1;
        if (current._tag === "ready") {
          const idleFiber = current.idleClose?.fiber ?? null;
          current.idleClose = null;
          return {
            _tag: "reserved" as const,
            idleFiber,
          };
        }
        return { _tag: "reserved" as const, idleFiber: null };
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
        const current = entries.get(databasePath);
        if (!current || current.demand === 0 || totalDemand === 0) {
          return {
            _tag: "invalid" as const,
            failure: connectionEntryStateError(
              databasePath,
              "The SQLite task store released a connection without reserved demand.",
            ),
          };
        }
        const nextDemand = current.demand - 1;
        totalDemand -= 1;
        let idleEntry: ReadyConnectionEntry | null = null;
        if (current._tag === "vacant" && nextDemand === 0) {
          entries.delete(databasePath);
        } else {
          current.demand = nextDemand;
          if (accepting && current._tag === "ready" && nextDemand === 0) {
            idleEntry = current;
          }
        }
        return {
          _tag: "released" as const,
          idleEntry,
          shutdownWaiter: totalDemand === 0 ? shutdownWaiter : null,
        };
      });
      if (released._tag === "invalid") {
        return yield* released.failure;
      }
      if (released.idleEntry) {
        yield* scheduleIdleClose(databasePath, released.idleEntry);
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
            yield* releaseDemand(storage.databasePath).pipe(Effect.orDie);
            return yield* Effect.failCause(acquireExit.cause);
          }
          return acquireExit.value;
        }),
        (connection) => use({ ...storage, session: connection.session }),
        (connection) =>
          connection.operationSemaphore
            .release(1)
            .pipe(Effect.zipRight(releaseDemand(storage.databasePath)), Effect.orDie),
      );
      return yield* run.pipe(
        Effect.mapError((cause) =>
          mapSqliteTaskStoreAdapterError(operation, storage.databasePath, cause),
        ),
      );
    });

  const closeRetainedEntry = (databasePath: string, entry: ReadyConnectionEntry) =>
    Effect.gen(function* () {
      const closeFlight = yield* Deferred.make<void, HostOperationError>();
      const reservation = yield* Effect.sync(() => {
        const current = entries.get(databasePath);
        if (current === entry) {
          entries.set(databasePath, {
            _tag: "closing",
            demand: current.demand,
            flight: closeFlight,
          });
          return { _tag: "close" as const, connection: current.connection };
        }
        if (current?._tag === "closing") {
          return { _tag: "wait" as const, flight: current.flight };
        }
        return { _tag: "done" as const };
      });
      if (reservation._tag === "close") {
        yield* closeManagedConnection(databasePath, reservation.connection, closeFlight);
      } else if (reservation._tag === "wait") {
        yield* Deferred.await(reservation.flight);
      }
    });

  const dispose = () =>
    Effect.gen(function* () {
      const waiter = yield* Deferred.make<void>();
      const shutdown = yield* Effect.sync(() => {
        accepting = false;
        shutdownWaiter ??= waiter;
        const fibers: Fiber.RuntimeFiber<void, never>[] = [];
        for (const entry of entries.values()) {
          if (entry._tag === "ready" && entry.idleClose) {
            fibers.push(entry.idleClose.fiber);
            entry.idleClose = null;
          }
        }
        return { drained: totalDemand === 0, fibers, waiter: shutdownWaiter };
      });
      yield* Effect.forEach(shutdown.fibers, Fiber.interruptFork, { discard: true });
      if (!shutdown.drained) {
        yield* Deferred.await(shutdown.waiter);
      }
      const pendingCloses = Array.from(entries.values()).flatMap((entry) =>
        entry._tag === "closing" ? [entry.flight] : [],
      );
      yield* Effect.forEach(pendingCloses, (flight) => Deferred.await(flight).pipe(Effect.ignore), {
        discard: true,
      });
      yield* Effect.forEach(
        Array.from(entries.entries()),
        ([databasePath, entry]) =>
          entry._tag === "ready"
            ? closeRetainedEntry(databasePath, entry).pipe(Effect.ignore)
            : Effect.void,
        { concurrency: "unbounded", discard: true },
      );
      const failures = Array.from(entries.values()).flatMap((entry) =>
        entry._tag === "failed" ? [entry.failure] : [],
      );
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
