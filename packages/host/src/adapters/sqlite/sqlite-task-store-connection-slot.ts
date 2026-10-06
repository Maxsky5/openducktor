import { Effect, Fiber } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ManagedSqliteTaskStoreConnection,
  OpenSqliteTaskStoreConnection,
} from "./sqlite-task-store-connection";
import type { TaskStoreSession } from "./sqlite-task-store-schema";
import { createSerialLane } from "../../effect/serial-gate";

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
  const operations = createSerialLane();
  let closeFailure: HostOperationErrorAggregate | null = null;
  let connection: ManagedSqliteTaskStoreConnection | null = null;
  let idleClose: Fiber.Fiber<void, never> | null = null;
  let idleGeneration = 0;

  const stopIdleClose = () =>
    Effect.gen(function* () {
      const fiber = idleClose;
      idleClose = null;
      idleGeneration += 1;
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
    });

  const closeCurrent = () =>
    Effect.gen(function* () {
      if (closeFailure) {
        return yield* Effect.fail(closeFailure);
      }
      if (!connection) return;

      const current = connection;
      const result = yield* Effect.result(current.release);
      if (result._tag === "Failure") {
        closeFailure = result.failure;
        return yield* Effect.fail(result.failure);
      }
      connection = null;
    });

  const scheduleIdleClose = () =>
    Effect.gen(function* () {
      idleGeneration += 1;
      const generation = idleGeneration;
      const fiber = yield* Effect.forkDetach(
        Effect.sleep(SQLITE_TASK_STORE_IDLE_TIMEOUT).pipe(
          Effect.andThen(
            operations.run(
              Effect.suspend(() => {
                if (generation !== idleGeneration) return Effect.void;
                idleClose = null;
                return closeCurrent();
              }),
            ),
          ),
          Effect.catch(onBackgroundFailure),
        ),
      );
      idleClose = fiber;
    });

  const run: SqliteTaskStoreConnectionSlot["run"] = (use) =>
    operations.run(
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* stopIdleClose();
          if (closeFailure) {
            return yield* Effect.fail(closeFailure);
          }
          if (!connection) {
            connection = yield* openConnection(databasePath).pipe(
              Effect.withSpan("taskStore.openConnection"),
            );
          }
          return connection;
        }),
        (current) => use(current.session),
        scheduleIdleClose,
      ),
    );

  const shutdown = () =>
    operations
      .run(stopIdleClose().pipe(Effect.andThen(closeCurrent())))
      .pipe(Effect.withSpan("taskStore.shutdown"));

  return { run, shutdown };
};
