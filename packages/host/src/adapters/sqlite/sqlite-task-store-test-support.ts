import { agentSessionRecordSchema } from "@openducktor/contracts";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Effect, Exit, Scope } from "effect";
import { z } from "zod";
import { toHostOperationError } from "../../effect/host-errors";
import { openSqliteDrizzleConnection } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { TaskOwnershipReader, TaskStorePort } from "../../ports/task-repository-ports";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import {
  createSqliteHostDatabaseManager,
  type SqliteHostDatabaseManager,
  type SqliteWorkspacesReadProvider,
  type SqliteTaskRepositoryContextProvider,
} from "./sqlite-task-repository-context";
import type { OpenHostDatabaseConnection } from "./sqlite-host-database-connection";
import { ensureSchema } from "./sqlite-host-database-migrations";
import { legacyMigrationsFolder } from "./sqlite-legacy-task-store-migrations";
import { createSqliteTaskOwnershipReader } from "./sqlite-workspace-ownership-reads";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { importHostSharedConfig } from "./sqlite-host-settings-store";
import { hostSettings } from "./sqlite-host-settings-schema";
import { hostMetadata } from "./sqlite-host-database-schema";
import { hostDatabaseSchema } from "./sqlite-host-database-schema";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

type BunSqliteStatement = ReturnType<Database["prepare"]>;
const artifactCountRowSchema = z.object({ count: z.number() });
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

export const openHostDatabaseTestConnection: OpenHostDatabaseConnection = (databasePath) =>
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
        config: { schema: hostDatabaseSchema },
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
      yield* ensureSchema(connection.session, databasePath);
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
  readonly workspaceId: string;
  readonly scope: { workspaceId: string; repoPath: string };
  readonly contextProvider: SqliteTaskRepositoryContextProvider;
  readonly withHostDatabase: SqliteHostDatabaseManager["withHostDatabase"];
  readonly workspacesProvider: SqliteWorkspacesReadProvider;
  readonly taskOwnership: TaskOwnershipReader;
  readonly databasePath: string;
  readonly repoPath: string;
  readonly store: TaskStorePort;
};

export const createSqliteTaskStoreHarness = async ({
  now = createClock(),
  repoPath = "/repos/Fair Nest",
  taskWorkflows = builtinTaskWorkflows,
  workspaceId = "fairnest",
}: {
  readonly now?: () => Date;
  readonly repoPath?: string;
  readonly taskWorkflows?: TaskWorkflowResolver;
  readonly workspaceId?: string;
} = {}): Promise<SqliteTaskStoreTestHarness> => {
  const configDir = await makeTempDirectory();
  const databasePath = path.join(configDir, "database.sqlite");
  const contextManager = createSqliteHostDatabaseManager({
    taskWorkflows,
    configDir,
    openConnection: (databasePath) =>
      openHostDatabaseTestConnection(databasePath).pipe(
        Effect.tap(({ session }) =>
          Effect.gen(function* () {
            const [host] = yield* session.execute(
              (db) => db.select({ id: hostSettings.singletonId }).from(hostSettings),
              "test.readHostSettings",
            );
            if (!host) {
              const config = createDefaultGlobalConfig();
              config.hostId = "8d2dd770-fb8c-4da7-a4d9-23df3169982f";
              config.workspaces[workspaceId] = repoConfigFixture({
                workspaceId,
                repoPath,
                workspaceName: workspaceId,
              });
              yield* session.transaction("test.seedHostConfig", (transaction) =>
                importHostSharedConfig(transaction, config),
              );
            }
            yield* session.execute(
              (db) =>
                db
                  .insert(hostMetadata)
                  .values({ singletonId: 1, importComplete: true, catalogRevision: 0 })
                  .onConflictDoNothing(),
              "test.seedMetadata",
            );
          }),
        ),
      ),
  });
  const contextProvider = contextManager.withDatabase;
  const store = createSqliteTaskRepository({
    contextProvider,
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
    workspaceId,
    scope: { workspaceId, repoPath },
    contextProvider,
    withHostDatabase: contextManager.withHostDatabase,
    databasePath,
    workspacesProvider: contextManager.readWorkspaces,
    taskOwnership: createSqliteTaskOwnershipReader(contextManager.readWorkspaces),
    repoPath,
    store,
  };
};

export const readWorkflowArtifactCount = (
  databasePath: string,
  taskId: string,
  code: string,
): number => {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = useStatement(
      database,
      "select count(*) as count from task_artifacts where task_id = ? and classification = 'workflow' and code = ?",
      (statement) => statement.get(taskId, code),
    );
    const parsed = artifactCountRowSchema.safeParse(row);
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
  status = "open",
  taskId,
}: {
  readonly databasePath: string;
  readonly agentSessionsJson?: string;
  readonly issueType?: string;
  readonly status?: string;
  readonly taskId: string;
}): void => {
  const database = new Database(databasePath);
  try {
    const timestampMs = Date.parse("2026-06-10T10:00:00.000Z");
    database.run(
      "insert into tasks (workspace_id,id,title,description,status,issue_type,priority,created_at_ms,updated_at_ms) values ('fairnest',?,'Task','',?,?,2,?,?)",
      [taskId, status, issueType, timestampMs, timestampMs],
    );
    const sessions = agentSessionRecordSchema.array().parse(JSON.parse(agentSessionsJson));
    for (const [position, session] of sessions.entries()) {
      const model = session.selectedModel;
      database.run(
        "insert into task_sessions (workspace_id,task_id,position,external_session_id,role,started_at_ms,last_activity_at_ms,runtime_kind,working_directory,model_runtime_kind,model_provider_id,model_id,model_variant,model_profile_id,model_speed) values ('fairnest',?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          taskId,
          position,
          session.externalSessionId,
          session.role,
          Date.parse(session.startedAt),
          session.lastActivityAt ?? null,
          session.runtimeKind,
          session.workingDirectory,
          model?.runtimeKind ?? null,
          model?.providerId ?? null,
          model?.modelId ?? null,
          model?.variant ?? null,
          model?.profileId ?? null,
          model?.speed ?? null,
        ],
      );
    }
  } finally {
    database.close();
  }
};

/** Creates a database that has only the first migrations, as an older release left it. */
export const createLegacyTaskStore = async (
  databasePath: string,
  migrationCount: number,
): Promise<void> => {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.exec("PRAGMA synchronous = OFF");
    database.exec(
      "PRAGMA foreign_keys = ON; CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    const migrations = readMigrationFiles({
      migrationsFolder: legacyMigrationsFolder,
    });
    for (const migration of migrations.slice(0, migrationCount)) {
      for (const statement of migration.sql) database.exec(statement);
      database.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
        migration.hash,
        migration.folderMillis,
      ]);
    }
  } finally {
    database.close();
  }
};

/** Inserts a task row into a store that still has the columns of migrations 0000 to 0008. */
export const insertLegacyTask = ({
  databasePath,
  issueType = "task",
  parentId = null,
  qaRequired = 1,
  status = "open",
  taskId,
}: {
  readonly databasePath: string;
  readonly issueType?: string;
  readonly parentId?: string | null;
  readonly qaRequired?: number;
  readonly status?: string;
  readonly taskId: string;
}): void => {
  const database = new Database(databasePath);
  try {
    const timestampMs = Date.parse("2026-06-10T10:00:00.000Z");
    database.run(
      `insert into tasks (
          id, title, description, status, issue_type, priority, parent_id, qa_required,
          labels_json, agent_sessions_json, created_at_ms, updated_at_ms
        ) values (?, 'Task', '', ?, ?, 2, ?, ?, '[]', '[]', ?, ?)`,
      [taskId, status, issueType, parentId, qaRequired, timestampMs, timestampMs],
    );
  } finally {
    database.close();
  }
};
