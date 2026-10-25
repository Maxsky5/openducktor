import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
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
import { findTaskRecord, getTaskRecord, listTasksInDatabase } from "./sqlite-task-card-read-model";
import { insertTaskFromCreateInput } from "./sqlite-task-create";
import { listArtifactsInDatabase, readArtifactInDatabase } from "./sqlite-task-artifact-queries";
import {
  createArtifactInDatabase,
  deleteArtifactInDatabase,
  renameArtifactInDatabase,
  replaceArtifactInDatabase,
} from "./sqlite-task-artifact-writes";
import {
  clearTaskArtifacts,
  clearWorkflowArtifacts,
  insertWorkflowArtifact,
} from "./sqlite-task-workflow-artifact-writes";
import { taskMetadata } from "./sqlite-task-metadata-read-model";
import { listPullRequestSyncCandidatesInDatabase } from "./sqlite-task-pull-request-read-model";
import {
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
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.createArtifact",
        ({ session, workflow }) =>
          session.transaction("sqliteTaskRepository.createArtifact", (transaction) =>
            createArtifactInDatabase(transaction, input, now(), workflow),
          ),
      );
    },
    renameArtifact(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.renameArtifact",
        ({ session, workflow }) =>
          session.transaction("sqliteTaskRepository.renameArtifact", (transaction) =>
            renameArtifactInDatabase(transaction, input, now(), workflow),
          ),
      );
    },
    replaceArtifact(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.replaceArtifact",
        ({ session, workflow }) =>
          session.transaction("sqliteTaskRepository.replaceArtifact", (transaction) =>
            replaceArtifactInDatabase(transaction, input, now(), workflow),
          ),
      );
    },
    deleteArtifact(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.deleteArtifact",
        ({ session, workflow }) =>
          session.transaction("sqliteTaskRepository.deleteArtifact", (transaction) =>
            deleteArtifactInDatabase(transaction, input, workflow),
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
    clearWorkflowArtifacts(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.clearWorkflowArtifacts",
        ({ session }) =>
          session.transaction("sqliteTaskRepository.clearWorkflowArtifacts", (transaction) =>
            clearWorkflowArtifacts(transaction, input.taskId, input.repoPath, input.codes),
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
        ({ session, workspaceId, workflow }) =>
          session.transaction("sqliteTaskRepository.createTask", (transaction) =>
            Effect.gen(function* () {
              const createdAt = now();
              const taskId = yield* insertTaskFromCreateInput({
                createdAt,
                session: transaction,
                status: input.status,
                task: input.task,
                workspaceId,
              });
              return yield* getTaskRecord(transaction, taskId, input.repoPath, workflow);
            }),
          ),
      );
    },
    deleteTask(input) {
      return withDatabase(input.repoPath, "sqliteTaskRepository.deleteTask", ({ session }) =>
        session.transaction("sqliteTaskRepository.deleteTask", (transaction) =>
          Effect.gen(function* () {
            const root = yield* requireTaskRow(transaction, input.taskId, input.repoPath);
            yield* deleteTasks(transaction, new Set<string>([root.id]));
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
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.findTask",
        ({ session, workflow }) => findTaskRecord(session, input.taskId, workflow),
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
      return withDatabase(input.repoPath, "sqliteTaskRepository.getTask", ({ session, workflow }) =>
        getTaskRecord(session, input.taskId, input.repoPath, workflow),
      );
    },
    getTaskMetadata(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.getTaskMetadata",
        ({ session, workflow }) =>
          Effect.gen(function* () {
            const row = yield* requireTaskRow(session, input.taskId, input.repoPath);
            return yield* taskMetadata(session, row, workflow);
          }),
      );
    },
    listPullRequestSyncCandidates(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listPullRequestSyncCandidates",
        ({ session, workflow }) =>
          listPullRequestSyncCandidatesInDatabase(session, workflow.terminalStates),
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
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.listTasks",
        ({ session, workflow }) => listTasksInDatabase(session, input, now, workflow),
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
    saveWorkflowArtifact(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.saveWorkflowArtifact",
        ({ session, workflow }) =>
          Effect.gen(function* () {
            const declared = workflow.artifact(input.code);
            if (declared === undefined) {
              return yield* new HostValidationError({
                field: "code",
                message: `Task workflow "${workflow.definition.id}" has no workflow artifact ${input.code}.`,
                details: { code: input.code },
              });
            }
            // A started commit records its status change, also when the caller is interrupted.
            return yield* Effect.uninterruptible(
              session
                .transaction("sqliteTaskRepository.saveWorkflowArtifact", (transaction) =>
                  Effect.gen(function* () {
                    const previous = yield* requireTaskRow(
                      transaction,
                      input.taskId,
                      input.repoPath,
                    );
                    const updatedAt = now();
                    if (input.status !== undefined) {
                      yield* updateTaskStatus(transaction, {
                        status: input.status,
                        taskId: input.taskId,
                        updatedAt,
                      });
                    }
                    const artifact = yield* insertWorkflowArtifact(transaction, {
                      code: input.code,
                      name: declared.label,
                      markdown: input.markdown,
                      taskId: input.taskId,
                      updatedAt,
                      verdict: input.verdict,
                      sourceTool: input.sourceTool,
                      updatedBy: input.updatedBy,
                    });
                    const task = yield* getTaskRecord(
                      transaction,
                      input.taskId,
                      input.repoPath,
                      workflow,
                    );
                    return { task, artifact, previousStatus: previous.status };
                  }),
                )
                .pipe(
                  Effect.flatMap(({ task, artifact, previousStatus }) =>
                    recordCommittedTaskStatusChange({
                      task,
                      previousStatus,
                      cause: input.cause,
                    }).pipe(Effect.as({ task, artifact })),
                  ),
                ),
            );
          }),
      );
    },
    transitionTask(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.transitionTask",
        ({ session, workflow }) =>
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
                  const task = yield* getTaskRecord(
                    transaction,
                    input.taskId,
                    input.repoPath,
                    workflow,
                  );
                  return { task, previousStatus: previous.status, cause: input.cause };
                }),
              )
              .pipe(Effect.flatMap(recordCommittedTaskStatusChange)),
          ),
      );
    },
    updateTask(input) {
      return withDatabase(
        input.repoPath,
        "sqliteTaskRepository.updateTask",
        ({ session, workflow }) =>
          session.transaction("sqliteTaskRepository.updateTask", (transaction) =>
            Effect.gen(function* () {
              yield* requireTaskRow(transaction, input.taskId, input.repoPath);
              return yield* applyTaskPatch(transaction, input, now(), workflow);
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
