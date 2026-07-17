import type { TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { encodeJson, normalizeLabels } from "./sqlite-json-codecs";
import {
  clearAgentSessionsByRoles,
  deleteAgentSession,
  listAgentSessionsForTasks,
  upsertAgentSession,
} from "./sqlite-task-agent-sessions";
import { getTaskCard, listTasksInDatabase } from "./sqlite-task-card-read-model";
import {
  clearQaReportDocuments,
  clearWorkflowDocuments,
  insertDocument,
  planSourceTool,
  qaReportSourceTool,
  specSourceTool,
} from "./sqlite-task-document-writes";
import {
  firstTaskIdHashLength,
  taskIdCandidates,
  taskIdExhaustedError,
  taskIdPrefixForWorkspaceId,
} from "./sqlite-task-ids";
import { taskMetadata } from "./sqlite-task-metadata-read-model";
import { listPullRequestSyncCandidatesInDatabase } from "./sqlite-task-pull-request-read-model";
import { descendantTaskIds, requireTaskRow } from "./sqlite-task-queries";
import {
  createSqliteTaskRepositoryContextProvider,
  type ResolveSqliteTaskStorePath,
  type ResolveWorkspaceIdForRepoPath,
} from "./sqlite-task-repository-context";
import type { TaskInsert } from "./sqlite-task-store-schema";
import {
  applyTaskPatch,
  deleteTasks,
  insertTaskIfAbsent,
  setDirectMergeRecord,
  setPullRequestRecord,
  updateTaskStatus,
} from "./sqlite-task-writes";

const readyTaskStoreHealth = (databasePath: string) => ({
  category: "healthy" as const,
  status: "ready" as const,
  isReady: true,
  detail: "SQLite task store is ready.",
  databasePath,
});

const blockingTaskStoreHealth = (detail: string) => ({
  category: "database_unavailable" as const,
  status: "blocking" as const,
  isReady: false,
  detail,
  databasePath: null,
});

const taskInsertFromCreateInput = (
  task: TaskCreateInput,
  taskId: string,
  createdAt: Date,
): TaskInsert => ({
  agentSessionsJson: encodeJson([]),
  createdAt,
  description: task.description ?? null,
  directMergeJson: null,
  id: taskId,
  issueType: task.issueType ?? "task",
  labelsJson: encodeJson(normalizeLabels(task.labels ?? [])),
  parentId: task.parentId ?? null,
  priority: task.priority ?? 2,
  pullRequestJson: null,
  qaRequired: task.aiReviewEnabled === false ? 0 : 1,
  status: "open",
  targetBranchJson: null,
  title: task.title,
  updatedAt: createdAt,
});

export type CreateSqliteTaskRepositoryInput = {
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
  resolveDatabasePath?: ResolveSqliteTaskStorePath;
  resolveWorkspaceIdForRepoPath: ResolveWorkspaceIdForRepoPath;
};

export const createSqliteTaskRepository = ({
  now = () => new Date(),
  processEnv = process.env,
  resolveDatabasePath,
  resolveWorkspaceIdForRepoPath,
}: CreateSqliteTaskRepositoryInput): TaskStorePort => {
  const withDatabase = createSqliteTaskRepositoryContextProvider({
    processEnv,
    ...(resolveDatabasePath === undefined ? {} : { resolveDatabasePath }),
    resolveWorkspaceIdForRepoPath,
  });

  return {
    clearAgentSessionsByRoles(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearAgentSessionsByRoles",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.clearAgentSessionsByRoles", (transaction) =>
            clearAgentSessionsByRoles(transaction, input, now()),
          ),
      );
    },
    deleteAgentSession(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.deleteAgentSession",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.deleteAgentSession", (transaction) =>
            deleteAgentSession(transaction, input, now()),
          ),
      );
    },
    clearQaReports(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.clearQaReports", ({ session }) =>
        session.transaction("sqliteTaskRepository.clearQaReports", (transaction) =>
          clearQaReportDocuments(transaction, input.taskId, input.repoPath),
        ),
      );
    },
    clearWorkflowDocuments(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearWorkflowDocuments",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.clearWorkflowDocuments", (transaction) =>
            clearWorkflowDocuments(transaction, input.taskId, input.repoPath),
          ),
      );
    },
    createTask(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.createTask",
        ({ session, workspaceId }) =>
          session.transaction("sqliteTaskRepository.createTask", (transaction) =>
            Effect.gen(function* () {
              const createdAt = now();
              const prefix = taskIdPrefixForWorkspaceId(workspaceId);
              const firstLength = yield* firstTaskIdHashLength(transaction, prefix);
              const candidates = taskIdCandidates({
                createdAt,
                description: input.task.description,
                firstLength,
                prefix,
                title: input.task.title,
              });
              for (const taskId of candidates) {
                const task = taskInsertFromCreateInput(input.task, taskId, createdAt);
                if (yield* insertTaskIfAbsent(transaction, task)) {
                  return yield* getTaskCard(transaction, taskId, input.repoPath);
                }
              }
              return yield* taskIdExhaustedError(prefix);
            }),
          ),
      );
    },
    deleteTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.deleteTask", ({ session }) =>
        session.transaction("sqliteTaskRepository.deleteTask", (transaction) =>
          Effect.gen(function* () {
            const root = yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            const targetIds = input.deleteSubtasks
              ? yield* descendantTaskIds(transaction, root.id)
              : new Set<string>([root.id]);
            yield* deleteTasks(transaction, targetIds);
            return true;
          }),
        ),
      );
    },
    diagnoseRepoStore(input) {
      const diagnose = withDatabase(
        input.repoPath,
        "sqliteTaskRepository.diagnoseRepoStore",
        ({ databasePath }) => Effect.succeed(readyTaskStoreHealth(databasePath)),
      );
      return Effect.catchAll(diagnose, (cause) =>
        Effect.succeed(blockingTaskStoreHealth(errorMessage(cause))),
      );
    },
    getTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.getTask", ({ session }) =>
        getTaskCard(session, input.taskId, input.repoPath),
      );
    },
    getTaskMetadata(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.getTaskMetadata", ({ session }) =>
        Effect.gen(function* () {
          const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
          return yield* taskMetadata(session, row);
        }),
      );
    },
    listPullRequestSyncCandidates(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listPullRequestSyncCandidates",
        ({ session }) => listPullRequestSyncCandidatesInDatabase(session),
      );
    },
    listAgentSessionsForTasks(input) {
      if (input.taskIds.length === 0) {
        return Effect.succeed([]);
      }
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listAgentSessionsForTasks",
        ({ session }) => listAgentSessionsForTasks(session, input),
      );
    },
    listTasks(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.listTasks", ({ session }) =>
        listTasksInDatabase(session, input, now),
      );
    },
    recordQaOutcome(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.recordQaOutcome", ({ session }) =>
        session.transaction("sqliteTaskRepository.recordQaOutcome", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            const updatedAt = now();
            yield* updateTaskStatus(transaction, {
              status: input.status,
              taskId: input.taskId,
              updatedAt,
            });
            yield* insertDocument(transaction, {
              kind: "qa_report",
              markdown: input.markdown,
              sourceTool: qaReportSourceTool(input.verdict),
              taskId: input.taskId,
              updatedAt,
              updatedBy: "qa-agent",
              verdict: input.verdict,
            });
            return yield* getTaskCard(transaction, input.taskId, input.repoPath);
          }),
        ),
      );
    },
    setDirectMerge(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setDirectMerge", ({ session }) =>
        session.transaction("sqliteTaskRepository.setDirectMerge", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* setDirectMergeRecord(transaction, {
              directMerge: input.directMerge,
              taskId: input.taskId,
              updatedAt: now(),
            });
          }),
        ),
      );
    },
    setPlanDocument(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setPlanDocument", ({ session }) =>
        session.transaction("sqliteTaskRepository.setPlanDocument", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* insertDocument(transaction, {
              kind: "implementation_plan",
              markdown: input.markdown,
              sourceTool: planSourceTool,
              taskId: input.taskId,
              updatedAt: now(),
              updatedBy: "planner-agent",
            });
          }),
        ),
      );
    },
    setPullRequest(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setPullRequest", ({ session }) =>
        session.transaction("sqliteTaskRepository.setPullRequest", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* setPullRequestRecord(transaction, {
              pullRequest: input.pullRequest,
              taskId: input.taskId,
              updatedAt: now(),
            });
          }),
        ),
      );
    },
    setSpecDocument(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setSpecDocument", ({ session }) =>
        session.transaction("sqliteTaskRepository.setSpecDocument", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* insertDocument(transaction, {
              kind: "spec",
              markdown: input.markdown,
              sourceTool: specSourceTool,
              taskId: input.taskId,
              updatedAt: now(),
              updatedBy: "planner-agent",
            });
          }),
        ),
      );
    },
    transitionTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.transitionTask", ({ session }) =>
        session.transaction("sqliteTaskRepository.transitionTask", (transaction) =>
          Effect.gen(function* () {
            yield* updateTaskStatus(transaction, {
              status: input.status,
              taskId: input.taskId,
              updatedAt: now(),
            });
            return yield* getTaskCard(transaction, input.taskId, input.repoPath);
          }),
        ),
      );
    },
    updateTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.updateTask", ({ session }) =>
        session.transaction("sqliteTaskRepository.updateTask", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* applyTaskPatch(transaction, input, now());
          }),
        ),
      );
    },
    upsertAgentSession(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.upsertAgentSession",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.upsertAgentSession", (transaction) =>
            upsertAgentSession(transaction, input, now()),
          ),
      );
    },
  };
};
