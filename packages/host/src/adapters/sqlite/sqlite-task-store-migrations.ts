import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { Effect } from "effect";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { TaskStoreSession, taskStoreSchema } from "./sqlite-task-store-schema";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "drizzle");
type TaskStoreRootDatabase = SqliteRemoteDatabase<typeof taskStoreSchema>;

const runMigrationQueries = (
  session: TaskStoreSession,
  migrationQueries: readonly string[],
): Effect.Effect<void, TaskStoreError> =>
  session
    .transaction("sqliteTaskRepository.runMigrationQueries", (transaction) =>
      Effect.forEach(
        migrationQueries,
        (migrationQuery) =>
          transaction.execute(
            (database) => database.run(sql.raw(migrationQuery)),
            "sqliteTaskRepository.runMigrationQuery",
          ),
        { discard: true },
      ),
    )
    .pipe(Effect.asVoid);

export const ensureSchema = (
  database: TaskStoreRootDatabase,
  session: TaskStoreSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  session
    .execute(
      () =>
        migrate(
          database,
          (migrationQueries) => Effect.runPromise(runMigrationQueries(session, migrationQueries)),
          { migrationsFolder },
        ),
      "sqliteTaskRepository.ensureSchema",
      { databasePath, migrationsFolder },
    )
    .pipe(
      Effect.mapError((cause) =>
        mapSqliteTaskStoreAdapterError("sqliteTaskRepository.ensureSchema", databasePath, cause),
      ),
    );
