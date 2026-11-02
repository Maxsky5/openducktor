import { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ManagedHostDatabaseConnection,
  OpenHostDatabaseConnection,
} from "./sqlite-host-database-connection";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { createSerialLane } from "../../effect/serial-gate";

export type HostDatabaseConnectionSlot = {
  readonly run: <A, E>(
    use: (session: HostDatabaseSession) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | TaskStoreError>;
  readonly shutdown: () => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createHostDatabaseConnectionSlot = ({
  databasePath,
  openConnection,
}: {
  databasePath: string;
  openConnection: OpenHostDatabaseConnection;
}): HostDatabaseConnectionSlot => {
  const operations = createSerialLane();
  let closeFailure: HostOperationErrorAggregate | null = null;
  let connection: ManagedHostDatabaseConnection | null = null;
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

  const run: HostDatabaseConnectionSlot["run"] = (use) =>
    operations.run(
      Effect.gen(function* () {
        if (closeFailure) return yield* Effect.fail(closeFailure);
        if (!connection)
          connection = yield* openConnection(databasePath).pipe(
            Effect.withSpan("taskStore.openConnection"),
          );
        return yield* use(connection.session);
      }),
    );

  const shutdown = () => operations.run(closeCurrent()).pipe(Effect.withSpan("taskStore.shutdown"));

  return { run, shutdown };
};
