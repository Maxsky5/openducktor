import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { Effect, Exit, Scope } from "effect";
import { z } from "zod";
import { toHostOperationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import {
  createSqliteTaskRepositoryContextManager,
  type SqliteTaskRepositoryContextManager,
  type SqliteTaskRepositoryContextProvider,
} from "./sqlite-task-repository-context";
import type { OpenSqliteTaskStoreConnection } from "./sqlite-task-store-connection";
import { ensureSchema } from "./sqlite-task-store-migrations";
import { taskStoreSchema } from "./sqlite-task-store-schema";

type BunSqliteStatement = ReturnType<Database["prepare"]>;
const documentCountRowSchema = z.object({ count: z.number() });
const tableNameRowSchema = z.object({ name: z.string() });
const migrationRowSchema = z.object({ hash: z.string() });
const taskColumnRowSchema = z.object({ name: z.string(), notnull: z.number() });

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

export const openSqliteTaskStoreTestConnection: OpenSqliteTaskStoreConnection = (databasePath) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(databasePath), { recursive: true }),
      catch: (cause) =>
        toHostOperationError(cause, "test.createSqliteDatabaseDirectory", { databasePath }),
    });
    const scope = yield* Scope.make();
    return yield* Effect.gen(function* () {
      const connection = yield* openSqliteDrizzleConnection({
        databasePath,
        configureWal: false,
        config: { schema: taskStoreSchema },
      });
      // Disposable fixtures need real SQLite transactions, but no power-loss durability.
      yield* connection.session.execute(
        (database) => database.run(sql`PRAGMA synchronous = OFF`),
        "test.disableSqliteDiskSync",
      );
      yield* connection.session.execute(
        (database) => database.run(sql`PRAGMA journal_mode = WAL`),
        "test.configureSqliteWal",
      );
      yield* ensureSchema(connection.database, connection.session, databasePath);
      return {
        release: connection.close.pipe(Effect.ensuring(Scope.close(scope, Exit.void))),
        session: connection.session,
      };
    }).pipe(
      Scope.provide(scope),
      Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
    );
  });

export type SqliteTaskStoreTestHarness = {
  readonly cleanup: () => Promise<void>;
  readonly configDir: string;
  readonly contextProvider: SqliteTaskRepositoryContextProvider;
  readonly listForWorktreeOwnership: SqliteTaskRepositoryContextManager["listWorkspaceSessionsForWorktreeOwnership"];
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
  const contextManager = createSqliteTaskRepositoryContextManager({
    assertWorkspaceOwnershipReadAdmitted: () => Effect.void,
    openConnection: openSqliteTaskStoreTestConnection,
    processEnv: {},
    resolveDatabasePath: ({ workspaceId }) =>
      resolveSqliteTaskStoreDatabasePath({ configDir, workspaceId }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed(workspaceId),
  });
  const store = createSqliteTaskRepository({
    contextProvider: contextManager.withDatabase,
    now,
  });
  return {
    cleanup: async () => {
      try {
        await Effect.runPromise(contextManager.dispose());
      } finally {
        await rm(configDir, { force: true, recursive: true });
      }
    },
    configDir,
    contextProvider: contextManager.withDatabase,
    databasePath,
    listForWorktreeOwnership: contextManager.listWorkspaceSessionsForWorktreeOwnership,
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
    const parsed = documentCountRowSchema.safeParse(row);
    return parsed.success ? parsed.data.count : 0;
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
    return rows.flatMap((row) => {
      const parsed = tableNameRowSchema.safeParse(row);
      return parsed.success ? [parsed.data.name] : [];
    });
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
    return rows.flatMap((row) => {
      const parsed = migrationRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
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
    for (const row of rows) {
      const parsed = taskColumnRowSchema.safeParse(row);
      if (parsed.success && parsed.data.name === columnName) {
        return parsed.data.notnull === 0;
      }
    }
    return undefined;
  } finally {
    database.close();
  }
};

export const insertRawTask = ({
  databasePath,
  agentSessionsJson = "[]",
  issueType = "task",
  qaRequired = 1,
  status = "open",
  taskId,
}: {
  readonly databasePath: string;
  readonly agentSessionsJson?: string;
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
          agentSessionsJson,
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
