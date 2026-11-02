import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import { applyMigrations } from "./sqlite-migrations";
import { mapSqliteTaskStoreAdapterError } from "./sqlite-task-store-errors";
import type { LegacyTaskStoreSession } from "./sqlite-legacy-task-store-schema";

export const legacyMigrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "drizzle");

export const ensureLegacySchema = (
  session: LegacyTaskStoreSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  applyMigrations(session, legacyMigrationsFolder, databasePath, "lastApplied").pipe(
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
