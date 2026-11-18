import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import { hostMigrationsFolder } from "./sqlite-migration-assets";
import { applyMigrations } from "./sqlite-migrations";

export const ensureSchema = (
  session: HostDatabaseSession,
  databasePath: string,
): Effect.Effect<void, TaskStoreError> =>
  applyMigrations(session, hostMigrationsFolder, databasePath, "exact").pipe(
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
