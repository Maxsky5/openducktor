import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createSqliteTaskRepository } from "./sqlite-task-repository";

type BunSqliteStatement = ReturnType<Database["prepare"]>;

const makeTempDirectory = async (): Promise<string> => {
  return mkdtemp(path.join(tmpdir(), "odt-sqlite-task-store-"));
};

const useStatement = <A>(
  database: Database,
  sql: string,
  use: (statement: BunSqliteStatement) => A,
): A => {
  const statement = database.prepare(sql);
  try {
    return use(statement);
  } finally {
    statement.finalize();
  }
};

const createClock = (): (() => Date) => {
  let next = Date.parse("2026-06-10T10:00:00.000Z");
  return () => {
    const date = new Date(next);
    next += 1000;
    return date;
  };
};

export type SqliteTaskStoreTestHarness = {
  readonly cleanup: () => Promise<void>;
  readonly configDir: string;
  readonly databasePath: string;
  readonly repoPath: string;
  readonly store: TaskStorePort;
};

export const createSqliteTaskStoreHarness = async ({
  now = createClock(),
  repoPath = "/repos/Fair Nest",
  workspaceId = "fairnest",
}: {
  readonly now?: () => Date;
  readonly repoPath?: string;
  readonly workspaceId?: string;
} = {}): Promise<SqliteTaskStoreTestHarness> => {
  const configDir = await makeTempDirectory();
  const databasePath = Effect.runSync(
    resolveSqliteTaskStoreDatabasePath({ configDir, workspaceId }),
  );
  const store = createSqliteTaskRepository({
    now,
    resolveDatabasePath: ({ workspaceId }) =>
      resolveSqliteTaskStoreDatabasePath({ configDir, workspaceId }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed(workspaceId),
  });
  return {
    cleanup: () => rm(configDir, { force: true, recursive: true }),
    configDir,
    databasePath,
    repoPath,
    store,
  };
};

export const readDocumentCount = (databasePath: string, taskId: string, kind: string): number => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = useStatement(
      database,
      "select count(*) as count from task_documents where task_id = ? and kind = ?",
      (statement) => statement.get(taskId, kind),
    );
    return typeof row === "object" &&
      row !== null &&
      "count" in row &&
      typeof row.count === "number"
      ? row.count
      : 0;
  } finally {
    database.close();
  }
};

export const readTableNames = (databasePath: string): string[] => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = useStatement(
      database,
      "select name from sqlite_master where type = 'table'",
      (statement) => statement.all(),
    );
    return rows
      .map((row) =>
        typeof row === "object" && row !== null && "name" in row && typeof row.name === "string"
          ? row.name
          : null,
      )
      .filter((name): name is string => name !== null);
  } finally {
    database.close();
  }
};

export const readDrizzleMigrationRows = (databasePath: string): Array<{ hash: string }> => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = useStatement(
      database,
      "select hash from __drizzle_migrations order by id",
      (statement) => statement.all(),
    );
    return rows
      .map((row) =>
        typeof row === "object" && row !== null && "hash" in row && typeof row.hash === "string"
          ? { hash: row.hash }
          : null,
      )
      .filter((row): row is { hash: string } => row !== null);
  } finally {
    database.close();
  }
};

export const readTaskColumnNullability = (
  databasePath: string,
  columnName: string,
): boolean | undefined => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = useStatement(database, "PRAGMA table_info(tasks)", (statement) => statement.all());
    const column = rows.find(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "name" in row &&
        row.name === columnName &&
        "notnull" in row,
    );
    if (
      typeof column === "object" &&
      column !== null &&
      "notnull" in column &&
      typeof column.notnull === "number"
    ) {
      return column.notnull === 0;
    }
    return undefined;
  } finally {
    database.close();
  }
};

export const insertRawTask = ({
  databasePath,
  issueType = "task",
  qaRequired = 1,
  status = "open",
  taskId,
}: {
  readonly databasePath: string;
  readonly issueType?: string;
  readonly qaRequired?: number;
  readonly status?: string;
  readonly taskId: string;
}): void => {
  const database = new Database(databasePath);
  try {
    const timestampMs = Date.parse("2026-06-10T10:00:00.000Z");
    useStatement(
      database,
      `insert into tasks (
          id, title, description, status, issue_type, priority, parent_id, qa_required,
          labels_json, agent_sessions_json, target_branch_json, pull_request_json,
          direct_merge_json, created_at_ms, updated_at_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      (statement) =>
        statement.run(
          taskId,
          "Task",
          "",
          status,
          issueType,
          2,
          null,
          qaRequired,
          "[]",
          "[]",
          null,
          null,
          null,
          timestampMs,
          timestampMs,
        ),
    );
  } finally {
    database.close();
  }
};
