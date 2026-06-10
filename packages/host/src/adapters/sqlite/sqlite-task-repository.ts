import { mkdir } from "node:fs/promises";
import path from "node:path";
import { directMergeRecordSchema, pullRequestSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { openSqliteDatabase, type SqliteDatabase } from "../../infrastructure/sqlite/sqlite-driver";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import type {
  TaskStoreError,
  TaskStoreListTasksInput,
  TaskStorePort,
} from "../../ports/task-repository-ports";
import { compactAgentSessionForStorage } from "./sqlite-task-store-agent-sessions";
import { applyTaskPatch } from "./sqlite-task-store-patches";
import {
  agentSessionsFromRow,
  encodeJson,
  finalizeTaskCards,
  getTaskCard,
  insertDocument,
  nextTaskId,
  normalizeLabels,
  planSourceTool,
  qaReportSourceTool,
  requireTaskRow,
  rowToTaskCard,
  specSourceTool,
  taskMetadata,
  taskRows,
} from "./sqlite-task-store-records";
import {
  ensureSchema,
  executeSql,
  isRecord,
  mapTaskStoreErrors,
  repoStoreHealth,
  toTaskStoreError,
  transaction,
} from "./sqlite-task-store-support";

type ResolveWorkspaceIdForRepoPath = (repoPath: string) => Effect.Effect<string, TaskStoreError>;

export type ResolveSqliteTaskStorePath = (input: {
  repoPath: string;
  workspaceId: string;
}) => string;

export type CreateSqliteTaskRepositoryInput = {
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

type SqliteTaskRepositoryContext = {
  database: SqliteDatabase;
  databasePath: string;
  repoPath: string;
  workspaceId: string;
};

const resolveDefaultDatabasePath =
  (processEnv: NodeJS.ProcessEnv): ResolveSqliteTaskStorePath =>
  ({ workspaceId }) =>
    resolveSqliteTaskStoreDatabasePath({
      configDir: resolveOpenDucktorBaseDir(processEnv),
      workspaceId,
    });

const descendantTaskIds = (database: SqliteDatabase, rootTaskId: string): Set<string> => {
  const targetIds = new Set<string>([rootTaskId]);
  let changed = true;
  while (changed) {
    changed = false;
    const placeholders = Array.from(targetIds, () => "?").join(", ");
    const childRows = database
      .prepare(`select id from tasks where parent_id in (${placeholders})`)
      .all(...Array.from(targetIds));
    for (const child of childRows) {
      if (isRecord(child) && typeof child.id === "string" && !targetIds.has(child.id)) {
        targetIds.add(child.id);
        changed = true;
      }
    }
  }
  return targetIds;
};

const listTasksInDatabase = (
  database: SqliteDatabase,
  input: TaskStoreListTasksInput,
  now: () => Date,
) => {
  if (input.doneVisibleDays === undefined) {
    return finalizeTaskCards(taskRows(database, "", []).map((row) => rowToTaskCard(database, row)));
  }
  const cutoffMs = now().getTime() - input.doneVisibleDays * 24 * 60 * 60 * 1000;
  const rows =
    input.doneVisibleDays > 0
      ? taskRows(database, "where status <> ? or updated_at_ms >= ?", ["closed", cutoffMs])
      : taskRows(database, "where status <> ?", ["closed"]);
  return finalizeTaskCards(rows.map((row) => rowToTaskCard(database, row)));
};

export const createSqliteTaskRepository = ({
  now = () => new Date(),
  processEnv = process.env,
  resolveDatabasePath = resolveDefaultDatabasePath(processEnv),
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryInput): TaskStorePort => {
  const resolveContext = (repoPath: string) =>
    Effect.gen(function* () {
      const workspaceId = yield* resolveWorkspaceIdForRepoPath(repoPath);
      const databasePath = yield* Effect.try({
        try: () => resolveDatabasePath({ repoPath, workspaceId }),
        catch: toTaskStoreError,
      });
      yield* Effect.tryPromise({
        try: () => mkdir(path.dirname(databasePath), { recursive: true }),
        catch: (cause) =>
          new HostOperationError({
            operation: "sqliteTaskRepository.createDatabaseDirectory",
            message: errorMessage(cause),
            cause,
            details: { databasePath },
          }),
      });
      const database = yield* openSqliteDatabase(databasePath).pipe(
        Effect.mapError(toTaskStoreError),
      );
      return {
        database,
        databasePath,
        repoPath,
        workspaceId,
      } satisfies SqliteTaskRepositoryContext;
    });

  const withDatabase = <A>(
    repoPath: string,
    operation: string,
    use: (context: SqliteTaskRepositoryContext) => A,
  ): Effect.Effect<A, TaskStoreError> =>
    Effect.acquireUseRelease(
      resolveContext(repoPath),
      (context) =>
        Effect.gen(function* () {
          yield* ensureSchema(context.database, context.databasePath);
          return yield* executeSql(operation, context.databasePath, () => use(context));
        }),
      (context) =>
        Effect.sync(() => {
          context.database.close();
        }),
    ).pipe(mapTaskStoreErrors);

  return {
    clearAgentSessionsByRoles(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearAgentSessionsByRoles",
        ({ database }) =>
          transaction(database, () => {
            const roleSet = new Set(input.roles.map((role) => role.trim()).filter(Boolean));
            if (roleSet.size === 0) {
              return true;
            }
            const row = requireTaskRow(database, input.taskId, input.repoPath);
            const remaining = agentSessionsFromRow(row).filter(
              (session) => !roleSet.has(session.role.trim()),
            );
            database
              .prepare("update tasks set agent_sessions_json = ?, updated_at_ms = ? where id = ?")
              .run(encodeJson(remaining), now().getTime(), input.taskId);
            return true;
          }),
      );
    },
    clearQaReports(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.clearQaReports", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          database
            .prepare("delete from task_documents where task_id = ? and kind = ?")
            .run(input.taskId, "qa_report");
          return true;
        }),
      );
    },
    clearWorkflowDocuments(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearWorkflowDocuments",
        ({ database }) =>
          transaction(database, () => {
            requireTaskRow(database, input.taskId, input.repoPath);
            database
              .prepare("delete from task_documents where task_id = ? and kind in (?, ?, ?)")
              .run(input.taskId, "spec", "implementation_plan", "qa_report");
            return true;
          }),
      );
    },
    createTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.createTask", ({ database }) =>
        transaction(database, () => {
          const createdAtMs = now().getTime();
          const taskId = nextTaskId(database, input.repoPath);
          database
            .prepare(
              `insert into tasks (
                id, title, description, notes, status, issue_type, priority, parent_id, qa_required,
                labels_json, agent_sessions_json, target_branch_json, pull_request_json,
                direct_merge_json, created_at_ms, updated_at_ms
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              taskId,
              input.task.title,
              input.task.description ?? "",
              "",
              "open",
              input.task.issueType ?? "task",
              input.task.priority ?? 2,
              input.task.parentId ?? null,
              input.task.aiReviewEnabled === false ? 0 : 1,
              encodeJson(normalizeLabels(input.task.labels ?? [])),
              encodeJson([]),
              null,
              null,
              null,
              createdAtMs,
              createdAtMs,
            );
          return getTaskCard(database, taskId, input.repoPath);
        }),
      );
    },
    deleteTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.deleteTask", ({ database }) =>
        transaction(database, () => {
          const targetIds = input.deleteSubtasks
            ? descendantTaskIds(database, input.taskId)
            : new Set<string>([requireTaskRow(database, input.taskId, input.repoPath).id]);
          for (const taskId of targetIds) {
            database.prepare("delete from tasks where id = ?").run(taskId);
          }
          return true;
        }),
      );
    },
    diagnoseRepoStore(input) {
      const diagnose = withDatabase(
        input.repoPath,
        "sqliteTaskRepository.diagnoseRepoStore",
        ({ databasePath }) =>
          repoStoreHealth({
            databasePath,
            detail: "SQLite task store is ready.",
            isReady: true,
            status: "ready",
          }),
      );
      return Effect.catchAll(diagnose, (cause) =>
        Effect.succeed(
          repoStoreHealth({
            databasePath: null,
            detail: errorMessage(cause),
            isReady: false,
            status: "blocking",
          }),
        ),
      );
    },
    getTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.getTask", ({ database }) =>
        getTaskCard(database, input.taskId, input.repoPath),
      );
    },
    getTaskMetadata(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.getTaskMetadata", ({ database }) =>
        taskMetadata(database, requireTaskRow(database, input.taskId, input.repoPath)),
      );
    },
    listPullRequestSyncCandidates(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listPullRequestSyncCandidates",
        ({ database }) =>
          listTasksInDatabase(database, { repoPath: input.repoPath }, now).filter(
            (task) =>
              task.status !== "closed" &&
              task.status !== "deferred" &&
              (task.pullRequest?.state === "open" || task.pullRequest?.state === "draft"),
          ),
      );
    },
    listTasks(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.listTasks", ({ database }) =>
        listTasksInDatabase(database, input, now),
      );
    },
    recordQaOutcome(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.recordQaOutcome", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          const updatedAtMs = now().getTime();
          database
            .prepare("update tasks set status = ?, updated_at_ms = ? where id = ?")
            .run(input.status, updatedAtMs, input.taskId);
          insertDocument(database, {
            kind: "qa_report",
            markdown: input.markdown,
            sourceTool: qaReportSourceTool(input.verdict),
            taskId: input.taskId,
            updatedAtMs,
            updatedBy: "qa-agent",
            verdict: input.verdict,
          });
          return getTaskCard(database, input.taskId, input.repoPath);
        }),
      );
    },
    setDirectMerge(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setDirectMerge", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          const directMerge =
            input.directMerge === null ? null : directMergeRecordSchema.parse(input.directMerge);
          if (directMerge === null) {
            database
              .prepare("update tasks set direct_merge_json = ?, updated_at_ms = ? where id = ?")
              .run(null, now().getTime(), input.taskId);
            return true;
          }
          database
            .prepare(
              `update tasks
               set direct_merge_json = ?, pull_request_json = ?, updated_at_ms = ?
               where id = ?`,
            )
            .run(encodeJson(directMerge), null, now().getTime(), input.taskId);
          return true;
        }),
      );
    },
    setPlanDocument(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setPlanDocument", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          return insertDocument(database, {
            kind: "implementation_plan",
            markdown: input.markdown,
            sourceTool: planSourceTool,
            taskId: input.taskId,
            updatedAtMs: now().getTime(),
            updatedBy: "planner-agent",
          });
        }),
      );
    },
    setPullRequest(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setPullRequest", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          const pullRequest =
            input.pullRequest === null ? null : pullRequestSchema.parse(input.pullRequest);
          if (pullRequest === null) {
            database
              .prepare("update tasks set pull_request_json = ?, updated_at_ms = ? where id = ?")
              .run(null, now().getTime(), input.taskId);
            return true;
          }
          database
            .prepare(
              `update tasks
               set pull_request_json = ?, direct_merge_json = ?, updated_at_ms = ?
               where id = ?`,
            )
            .run(encodeJson(pullRequest), null, now().getTime(), input.taskId);
          return true;
        }),
      );
    },
    setSpecDocument(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setSpecDocument", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          return insertDocument(database, {
            kind: "spec",
            markdown: input.markdown,
            sourceTool: specSourceTool,
            taskId: input.taskId,
            updatedAtMs: now().getTime(),
            updatedBy: "planner-agent",
          });
        }),
      );
    },
    transitionTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.transitionTask", ({ database }) =>
        transaction(database, () => {
          database
            .prepare("update tasks set status = ?, updated_at_ms = ? where id = ?")
            .run(input.status, now().getTime(), input.taskId);
          return getTaskCard(database, input.taskId, input.repoPath);
        }),
      );
    },
    updateTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.updateTask", ({ database }) =>
        transaction(database, () => {
          requireTaskRow(database, input.taskId, input.repoPath);
          return applyTaskPatch(database, input, now().getTime());
        }),
      );
    },
    upsertAgentSession(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.upsertAgentSession",
        ({ database }) =>
          transaction(database, () => {
            const compactSession = compactAgentSessionForStorage(input.session);
            const row = requireTaskRow(database, input.taskId, input.repoPath);
            const sessions = agentSessionsFromRow(row);
            const existingIndex = sessions.findIndex(
              (entry) => entry.externalSessionId === compactSession.externalSessionId,
            );
            if (existingIndex >= 0) {
              sessions[existingIndex] = compactSession;
            } else {
              sessions.push(compactSession);
            }
            const nextSessions = sessions
              .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
              .slice(0, 100);
            database
              .prepare("update tasks set agent_sessions_json = ?, updated_at_ms = ? where id = ?")
              .run(encodeJson(nextSessions), now().getTime(), input.taskId);
            return true;
          }),
      );
    },
  };
};
