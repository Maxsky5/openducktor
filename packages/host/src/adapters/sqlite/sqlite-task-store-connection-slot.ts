import { Effect, Fiber } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ManagedSqliteTaskStoreConnection,
  OpenSqliteTaskStoreConnection,
} from "./sqlite-task-store-connection";
import type { TaskStoreSession } from "./sqlite-task-store-schema";

const SQLITE_TASK_STORE_IDLE_TIMEOUT = "5 minutes";

export type SqliteTaskStoreConnectionSlot = {
  readonly run: <A, E>(
    use: (session: TaskStoreSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | TaskStoreError>;
  readonly shutdown: () => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createSqliteTaskStoreConnectionSlot = ({
  databasePath,
  onBackgroundFailure,
  openConnection,
}: {
  databasePath: string;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  openConnection: OpenSqliteTaskStoreConnection;
}): SqliteTaskStoreConnectionSlot => {
  const operationSemaphore = Effect.unsafeMakeSemaphore(1);
  let closeFailure: HostOperationErrorAggregate | null = null;
  let connection: ManagedSqliteTaskStoreConnection | null = null;
  let idleClose: Fiber.RuntimeFiber<void, never> | null = null;
  let idleGeneration = 0;

  const stopIdleClose = () =>
    Effect.gen(function* () {
      const fiber = idleClose;
      idleClose = null;
      idleGeneration += 1;
      if (fiber) {
        yield* Fiber.interruptFork(fiber);
      }
    });

  const closeCurrent = () =>
    Effect.gen(function* () {
      if (closeFailure) {
        return yield* Effect.fail(closeFailure);
      }
      if (!connection) return;

      const current = connection;
      const result = yield* Effect.either(current.release);
      if (result._tag === "Left") {
        closeFailure = result.left;
        return yield* Effect.fail(result.left);
      }
      connection = null;
    });

  const scheduleIdleClose = () =>
    Effect.gen(function* () {
      idleGeneration += 1;
      const generation = idleGeneration;
      const fiber = yield* Effect.forkDaemon(
        Effect.sleep(SQLITE_TASK_STORE_IDLE_TIMEOUT).pipe(
          Effect.zipRight(
            operationSemaphore.withPermits(1)(
              Effect.suspend(() => {
                if (generation !== idleGeneration) return Effect.void;
                idleClose = null;
                return closeCurrent();
              }),
            ),
          ),
          Effect.catchAll(onBackgroundFailure),
        ),
      );
      idleClose = fiber;
    });

  const run: SqliteTaskStoreConnectionSlot["run"] = (use) =>
    operationSemaphore.withPermits(1)(
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* stopIdleClose();
          if (closeFailure) {
            return yield* Effect.fail(closeFailure);
          }
          if (!connection) {
            connection = yield* openConnection(databasePath);
          }
          return connection;
        }),
        (current) => use(current.session),
        scheduleIdleClose,
      ),
    );

  const shutdown = () =>
    operationSemaphore.withPermits(1)(stopIdleClose().pipe(Effect.zipRight(closeCurrent())));

  return { run, shutdown };
};
