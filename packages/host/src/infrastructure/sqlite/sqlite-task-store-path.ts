import path from "node:path";
import { WORKSPACE_ID_PATTERN } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostInvariantError } from "../../effect/host-errors";

export const TASK_STORE_DATABASE_FILENAME = "database.sqlite";

export type ResolveSqliteTaskStoreDatabasePathInput = {
  configDir: string;
  workspaceId: string;
};

export const validateSqliteTaskStoreWorkspaceId = (
  workspaceId: string,
): Effect.Effect<string, HostInvariantError> => {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    return Effect.fail(
      new HostInvariantError({
        invariant: "sqlite-task-store-workspace-id",
        message:
          "SQLite task store workspaceId must already be a valid workspace id before resolving a database path.",
        details: { workspaceId },
      }),
    );
  }
  return Effect.succeed(workspaceId);
};

export const sqliteTaskStoreDatabasePathSegments = (
  workspaceId: string,
): Effect.Effect<[string, string, typeof TASK_STORE_DATABASE_FILENAME], HostInvariantError> =>
  validateSqliteTaskStoreWorkspaceId(workspaceId).pipe(
    Effect.map((validWorkspaceId) => [
      "task-stores",
      validWorkspaceId,
      TASK_STORE_DATABASE_FILENAME,
    ]),
  );

export const resolveSqliteTaskStoreDatabasePath = ({
  configDir,
  workspaceId,
}: ResolveSqliteTaskStoreDatabasePathInput): Effect.Effect<string, HostInvariantError> =>
  sqliteTaskStoreDatabasePathSegments(workspaceId).pipe(
    Effect.map((segments) => path.join(configDir, ...segments)),
  );
