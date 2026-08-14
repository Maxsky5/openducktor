import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect, Exit, Scope } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { ensureSchema } from "./sqlite-task-store-migrations";
import { type TaskStoreSession, taskStoreSchema } from "./sqlite-task-store-schema";

export type ManagedSqliteTaskStoreConnection = {
  release: Effect.Effect<void, HostOperationError>;
  session: TaskStoreSession;
};

export type OpenSqliteTaskStoreConnection = (
  databasePath: string,
) => Effect.Effect<ManagedSqliteTaskStoreConnection, TaskStoreError>;

export const openSqliteTaskStoreConnection: OpenSqliteTaskStoreConnection = (databasePath) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(databasePath), { recursive: true }),
      catch: (cause) =>
        new HostOperationError({
          operation: "sqliteTaskRepository.createDatabaseDirectory",
          message: errorMessage(cause),
          cause,
          details: { databasePath },
        }),
    });
    const scope = yield* Scope.make();
    const openExit = yield* Effect.exit(
      Effect.gen(function* () {
        const connection = yield* openSqliteDrizzleConnection<typeof taskStoreSchema>({
          databasePath,
          configureWal: true,
          config: {
            schema: taskStoreSchema,
          },
        }).pipe(Scope.extend(scope));
        yield* ensureSchema(connection.database, connection.session, databasePath);
        return {
          release: connection.close.pipe(Effect.ensuring(Scope.close(scope, Exit.void))),
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
