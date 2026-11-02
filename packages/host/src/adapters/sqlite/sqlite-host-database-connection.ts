import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect, Exit, Scope } from "effect";
import {
  errorMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { ensureSchema } from "./sqlite-host-database-migrations";
import { type HostDatabaseSession, hostDatabaseSchema } from "./sqlite-host-database-schema";

export type ManagedHostDatabaseConnection = {
  release: Effect.Effect<void, HostOperationErrorAggregate>;
  session: HostDatabaseSession;
};

export type OpenHostDatabaseConnection = (
  databasePath: string,
) => Effect.Effect<ManagedHostDatabaseConnection, TaskStoreError>;

export const openHostDatabaseConnection: OpenHostDatabaseConnection = (databasePath) =>
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
        const connection = yield* openSqliteDrizzleConnection<typeof hostDatabaseSchema>({
          databasePath,
          configureWal: false,
          configureHostDatabase: true,
          config: {
            schema: hostDatabaseSchema,
          },
        }).pipe(Scope.provide(scope));
        yield* ensureSchema(connection.session, databasePath);
        return {
          release: connection.close.pipe(Effect.ensuring(Scope.close(scope, Exit.void))),
          session: connection.session,
        } satisfies ManagedHostDatabaseConnection;
      }),
    );
    if (Exit.isFailure(openExit)) {
      yield* Scope.close(scope, openExit);
      return yield* Effect.failCause(openExit.cause);
    }
    return openExit.value;
  });
