import path from "node:path";
import { WORKSPACE_ID_PATTERN } from "@openducktor/contracts";
import { HostInvariantError } from "../../effect/host-errors";

export const TASK_STORE_DATABASE_FILENAME = "database.sqlite";

export type ResolveSqliteTaskStoreDatabasePathInput = {
  configDir: string;
  workspaceId: string;
};

export const assertSqliteTaskStoreWorkspaceId = (workspaceId: string): string => {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new HostInvariantError({
      invariant: "sqlite-task-store-workspace-id",
      message:
        "SQLite task store workspaceId must already be a valid workspace id before resolving a database path.",
      details: { workspaceId },
    });
  }
  return workspaceId;
};

export const sqliteTaskStoreDatabasePathSegments = (
  workspaceId: string,
): [string, string, typeof TASK_STORE_DATABASE_FILENAME] => [
  "task-stores",
  assertSqliteTaskStoreWorkspaceId(workspaceId),
  TASK_STORE_DATABASE_FILENAME,
];

export const resolveSqliteTaskStoreDatabasePath = ({
  configDir,
  workspaceId,
}: ResolveSqliteTaskStoreDatabasePathInput): string =>
  path.join(configDir, ...sqliteTaskStoreDatabasePathSegments(workspaceId));
