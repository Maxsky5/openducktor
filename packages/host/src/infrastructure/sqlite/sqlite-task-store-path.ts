import path from "node:path";
import { WORKSPACE_ID_PATTERN } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostInvariantError } from "../../effect/host-errors";

export const TASK_STORE_DATABASE_FILENAME = "database.sqlite";

export type ResolveSqliteTaskStoreDatabasePathInput = {
  configDir: string;
  workspaceId: string;
};

const validateSqliteTaskStoreWorkspaceId = (
  workspaceId: string,
): Effect.Effect<string, HostInvariantError<{ workspaceId: string }>> => {
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

export const sqliteTaskStoreDirectoryPath = (configDir: string, workspaceId: string): string =>
  path.join(configDir, "task-stores", workspaceId);

const resolveSqliteTaskStoreDirectory = ({
  configDir,
  workspaceId,
}: ResolveSqliteTaskStoreDatabasePathInput): Effect.Effect<
  string,
  HostInvariantError<{ workspaceId: string }>
> =>
  validateSqliteTaskStoreWorkspaceId(workspaceId).pipe(
    Effect.map((validWorkspaceId) => sqliteTaskStoreDirectoryPath(configDir, validWorkspaceId)),
  );

export const resolveSqliteTaskStoreDatabasePath = (
  input: ResolveSqliteTaskStoreDatabasePathInput,
): Effect.Effect<string, HostInvariantError<{ workspaceId: string }>> =>
  resolveSqliteTaskStoreDirectory(input).pipe(
    Effect.map((directory) => path.join(directory, TASK_STORE_DATABASE_FILENAME)),
  );
