import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { Effect, Exit } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { TaskStoreSession, taskStoreSchema } from "./sqlite-task-store-schema";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "drizzle");
type TaskStoreRootDatabase = SqliteRemoteDatabase<typeof taskStoreSchema>;

/** Fails the migration transaction before commit when a table rebuild broke a reference. */
const runMigrationQueries = (
  session: TaskStoreSession,
  migrationQueries: readonly string[],
): Effect.Effect<void, TaskStoreError> =>
  session
    .transaction("sqliteTaskRepository.runMigrationQueries", (transaction) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          migrationQueries,
          (migrationQuery) =>
            transaction.execute(
              (database) => database.run(sql.raw(migrationQuery)),
              "sqliteTaskRepository.runMigrationQuery",
            ),
          { discard: true },
        );
        const violations = yield* transaction.execute(
          (database) => database.all(sql.raw("PRAGMA foreign_key_check")),
          "sqliteTaskRepository.checkMigrationForeignKeys",
        );
        if (violations.length > 0) {
          return yield* new HostOperationError({
            operation: "sqliteTaskRepository.checkMigrationForeignKeys",
            message: `The migration would leave ${violations.length} rows with a missing parent task. Report this database migration failure.`,
          });
        }
      }),
    )
    .pipe(Effect.asVoid);

const setForeignKeys = (session: TaskStoreSession, enabled: boolean) =>
  session.execute(
    (database) => database.run(sql.raw(`PRAGMA foreign_keys = ${enabled ? "ON" : "OFF"}`)),
    "sqliteTaskRepository.setForeignKeys",
  );

/**
 * A migration that rebuilds a parent table drops it, and SQLite cascades that drop to child rows
 * while foreign keys are on. The pragma has no effect inside a transaction, so it changes around
 * the migration transaction, as the SQLite schema change procedure requires.
 */
const migrateWithoutForeignKeys = (
  database: TaskStoreRootDatabase,
  session: TaskStoreSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  Effect.gen(function* () {
    yield* setForeignKeys(session, false);
    const migrated = yield* Effect.exit(
      session.execute(
        () =>
          migrate(
            database,
            (migrationQueries) => Effect.runPromise(runMigrationQueries(session, migrationQueries)),
            { migrationsFolder },
          ),
        "sqliteTaskRepository.ensureSchema",
        { databasePath, migrationsFolder },
      ),
    );
    yield* setForeignKeys(session, true);
    if (Exit.isFailure(migrated)) return yield* Effect.failCause(migrated.cause);
  });

export const ensureSchema = (
  database: TaskStoreRootDatabase,
  session: TaskStoreSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  migrateWithoutForeignKeys(database, session, databasePath).pipe(
    Effect.mapError((cause) => {
      const failure = mapSqliteTaskStoreAdapterError(
        "sqliteTaskRepository.ensureSchema",
        databasePath,
        cause,
      );
      return new HostOperationError({
        operation:
          failure instanceof HostOperationError
            ? failure.operation
            : "sqliteTaskRepository.ensureSchema",
        message: `Task-store migration failed. Resolve the database error before retrying: ${failure.message}`,
        cause: failure,
        details: { databasePath },
      });
    }),
  );
