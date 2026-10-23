import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { recordCommittedTaskStatusChange } from "../../ports/task-status-changes";
import {
  clearAgentSessionsByRoles,
  deleteAgentSession,
  listAgentSessionsForTasks,
  recordAgentSessionActivity,
  updateAgentSessionModel,
  upsertAgentSession,
} from "./sqlite-task-agent-sessions";
import { findTaskCard, getTaskCard, listTasksInDatabase } from "./sqlite-task-card-read-model";
import { insertTaskFromCreateInput } from "./sqlite-task-create";
import { listArtifactsInDatabase, readArtifactInDatabase } from "./sqlite-task-artifact-queries";
import {
  createArtifactInDatabase,
  deleteArtifactInDatabase,
  renameArtifactInDatabase,
  replaceArtifactInDatabase,
} from "./sqlite-task-artifact-writes";
import {
  clearQaReportArtifacts,
  clearTaskArtifacts,
  insertWorkflowArtifact,
  planSourceTool,
  qaReportSourceTool,
  specSourceTool,
} from "./sqlite-task-workflow-artifact-writes";
import { taskMetadata } from "./sqlite-task-metadata-read-model";
import { listPullRequestSyncCandidatesInDatabase } from "./sqlite-task-pull-request-read-model";
import {
  descendantTaskIds,
  listTaskIdsInDatabase,
  requireTaskRow,
  taskReferenceCandidates,
} from "./sqlite-task-queries";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import {
  applyTaskPatch,
  deleteTasks,
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

export type CreateSqliteTaskRepositoryInput = {
  contextProvider: SqliteTaskRepositoryContextProvider;
  now?: () => Date;
};

export const createSqliteTaskRepository = ({
  contextProvider: withDatabase,
  now = () => new Date(),
}: CreateSqliteTaskRepositoryInput): TaskStorePort => {
  return {
    listArtifacts(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.listArtifacts", ({ session }) =>
        Effect.gen(function* () {
          yield* requireTaskRow(session, input.taskId, input.repoPath);
          return yield* listArtifactsInDatabase(session, input.taskId);
        }),
      );
    },
    readArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.readArtifact", ({ session }) =>
        Effect.gen(function* () {
          yield* requireTaskRow(session, input.taskId, input.repoPath);
          return yield* readArtifactInDatabase(session, input);
        }),
      );
    },
    createArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.createArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.createArtifact", (transaction) =>
          createArtifactInDatabase(transaction, input, now()),
        ),
      );
    },
    renameArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.renameArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.renameArtifact", (transaction) =>
          renameArtifactInDatabase(transaction, input, now()),
        ),
      );
    },
    replaceArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.replaceArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.replaceArtifact", (transaction) =>
          replaceArtifactInDatabase(transaction, input, now()),
        ),
      );
    },
    deleteArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.deleteArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.deleteArtifact", (transaction) =>
          deleteArtifactInDatabase(transaction, input),
        ),
      );
    },
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
          clearQaReportArtifacts(transaction, input.taskId, input.repoPath),
        ),
      );
    },
    clearTaskArtifacts(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearTaskArtifacts",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.clearTaskArtifacts", (transaction) =>
            clearTaskArtifacts(transaction, input.taskId, input.repoPath),
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
              const taskId = yield* insertTaskFromCreateInput({
                createdAt,
                repoPath: input.repoPath,
                session: transaction,
                task: input.task,
                workspaceId,
              });
              return yield* getTaskCard(transaction, taskId, input.repoPath);
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
            if (input.expectedTaskIds) {
              const expectedTaskIds = new Set(input.expectedTaskIds);
              const targetsMatch =
                expectedTaskIds.size === targetIds.size &&
                Array.from(expectedTaskIds).every((taskId) => targetIds.has(taskId));
              if (!targetsMatch) {
                return yield* new HostOperationError({
                  operation: "sqliteTaskRepository.deleteTask",
                  message:
                    "The task hierarchy changed while its assets were prepared. Retry deletion.",
                  details: {
                    taskId: input.taskId,
                    expectedTaskIds: Array.from(expectedTaskIds),
                    actualTaskIds: Array.from(targetIds),
                  },
                });
              }
            }
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
      return Effect.catch(diagnose, (cause) =>
        Effect.succeed(blockingTaskStoreHealth(errorMessage(cause))),
      );
    },
    findTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.findTask", ({ session }) =>
        findTaskCard(session, input.taskId),
      );
    },
    listTaskReferences(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listTaskReferences",
        ({ session }) => taskReferenceCandidates(session),
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
    listTaskIds(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.listTaskIds", ({ session }) =>
        listTaskIdsInDatabase(session),
      );
    },
    listTasks(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.listTasks", ({ session }) =>
        listTasksInDatabase(session, input, now),
      );
    },
    recordQaOutcome(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.recordQaOutcome", ({ session }) =>
        // A started commit records its status change, also when the caller is interrupted.
        Effect.uninterruptible(
          session
            .transaction("sqliteTaskRepository.recordQaOutcome", (transaction) =>
              Effect.gen(function* () {
                const previous = yield* requireTaskRow(transaction, input.taskId, input.repoPath);
                const updatedAt = now();
                yield* updateTaskStatus(transaction, {
                  status: input.status,
                  taskId: input.taskId,
                  updatedAt,
                });
                const artifact = yield* insertWorkflowArtifact(transaction, {
                  kind: "qa_report",
                  markdown: input.markdown,
                  sourceTool: qaReportSourceTool(input.verdict),
                  taskId: input.taskId,
                  updatedAt,
                  updatedBy: "qa-agent",
                  verdict: input.verdict,
                });
                const task = yield* getTaskCard(transaction, input.taskId, input.repoPath);
                return { task, artifact, previousStatus: previous.status };
              }),
            )
            .pipe(
              Effect.flatMap(({ task, artifact, previousStatus }) =>
                recordCommittedTaskStatusChange({ task, previousStatus }).pipe(
                  Effect.as({ task, artifact }),
                ),
              ),
            ),
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
    setPlanArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setPlanArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.setPlanArtifact", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* insertWorkflowArtifact(transaction, {
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
    setSpecArtifact(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.setSpecArtifact", ({ session }) =>
        session.transaction("sqliteTaskRepository.setSpecArtifact", (transaction) =>
          Effect.gen(function* () {
            yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            return yield* insertWorkflowArtifact(transaction, {
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
        // A started commit records its status change, also when the caller is interrupted.
        Effect.uninterruptible(
          session
            .transaction("sqliteTaskRepository.transitionTask", (transaction) =>
              Effect.gen(function* () {
                const previous = yield* requireTaskRow(transaction, input.taskId, input.repoPath);
                yield* updateTaskStatus(transaction, {
                  status: input.status,
                  taskId: input.taskId,
                  updatedAt: now(),
                });
                const task = yield* getTaskCard(transaction, input.taskId, input.repoPath);
                return { task, previousStatus: previous.status };
              }),
            )
            .pipe(Effect.flatMap(recordCommittedTaskStatusChange)),
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
    recordAgentSessionActivity(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.recordAgentSessionActivity",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.recordAgentSessionActivity", (transaction) =>
            recordAgentSessionActivity(transaction, input),
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
    updateAgentSessionModel(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.updateAgentSessionModel",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.updateAgentSessionModel", (transaction) =>
            updateAgentSessionModel(transaction, input, now()),
          ),
      );
    },
  };
};
