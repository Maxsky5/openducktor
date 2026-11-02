import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { applyMigrations } from "./sqlite-migrations";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "drizzle-host");

export const ensureSchema = (
  session: HostDatabaseSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  applyMigrations(session, migrationsFolder, databasePath, "exact").pipe(
    Effect.mapError(
      (cause) =>
        new HostOperationError({
          operation: "sqliteHost.migrate",
          message: `Host database migration failed. Resolve the database error before retrying: ${cause.message}`,
          cause,
          details: { databasePath },
        }),
    ),
  );
