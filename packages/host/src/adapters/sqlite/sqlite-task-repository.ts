import { searchTasksInDatabase } from "./sqlite-task-search";
import { latestWorkflowArtifactRows } from "./sqlite-task-workflow-artifact-queries";
import { HostValidationError } from "../../effect/host-errors";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import type { TaskRecord, TaskStorePort } from "../../ports/task-repository-ports";
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
import { clearTaskArtifacts, clearWorkflowArtifacts } from "./sqlite-task-workflow-artifact-writes";
import { taskMetadata, taskDelivery, toMetadataArtifact } from "./sqlite-task-metadata-read-model";
import { listPullRequestSyncCandidatesInDatabase } from "./sqlite-task-pull-request-read-model";
import {
  listDirectMergeTaskIdsInDatabase,
  listTaskIdsInDatabase,
  requireTaskRow,
  taskReferenceCandidates,
  mergeCandidates,
} from "./sqlite-task-queries";
import {
  hostTerminalStates,
  type SqliteTaskRepositoryContextProvider,
  type SqliteTaskRepositoryContext,
} from "./sqlite-task-repository-context";
import {
  applyTaskPatch,
  deleteTasks,
  setDirectMergeRecord,
  setPullRequestRecord,
} from "./sqlite-task-writes";
import { commitTaskMutation, type TaskMutationResult } from "./sqlite-task-mutation";
import { createSqliteTaskWorkflowMutations } from "./sqlite-task-workflow-mutations";

const readyTaskStoreHealth = (databasePath: string) => ({
  category: "healthy" as const,
  status: "ready" as const,
  isReady: true,
  detail: "The host database is ready.",
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
  const withReadDatabase = <A>(
    input: { repoPath: string; workspaceId: string },
    operation: string,
    use: (context: SqliteTaskRepositoryContext) => Effect.Effect<A, unknown>,
  ) =>
    withDatabase(input, operation, (context) =>
      context.session.readTransaction(operation, (session) => use({ ...context, session })),
    );
  return {
    listArtifacts: (input) =>
      withReadDatabase(input, "sqliteTaskRepository.listArtifacts", ({ session, workspaceId }) =>
        Effect.gen(function* () {
          yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
          return yield* listArtifactsInDatabase(session, workspaceId, input.taskId);
        }),
      ),
    readArtifact: (input) =>
      withReadDatabase(input, "sqliteTaskRepository.readArtifact", ({ session, workspaceId }) =>
        Effect.gen(function* () {
          yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
          return yield* readArtifactInDatabase(session, workspaceId, input);
        }),
      ),
    createArtifact: (input) =>
      withDatabase(input, "sqliteTaskRepository.createArtifact", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.createArtifact", (session) =>
          createArtifactInDatabase(
            session,
            context.workspaceId,
            input,
            now(),
            context.taskWorkflows,
          ).pipe(
            Effect.map((value) => ({
              value,
              taskId: input.taskId,
              artifactChanges: [
                { taskId: input.taskId, artifactIds: [value.artifactId], removedArtifactIds: [] },
              ],
            })),
          ),
        ),
      ),
    renameArtifact: (input) =>
      withDatabase(input, "sqliteTaskRepository.renameArtifact", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.renameArtifact", (session) =>
          renameArtifactInDatabase(
            session,
            context.workspaceId,
            input,
            now(),
            context.taskWorkflows,
          ).pipe(
            Effect.map((value) => ({
              value,
              taskId: input.taskId,
              artifactChanges: [
                { taskId: input.taskId, artifactIds: [value.artifactId], removedArtifactIds: [] },
              ],
            })),
          ),
        ),
      ),
    replaceArtifact: (input) =>
      withDatabase(input, "sqliteTaskRepository.replaceArtifact", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.replaceArtifact", (session) =>
          replaceArtifactInDatabase(
            session,
            context.workspaceId,
            input,
            now(),
            context.taskWorkflows,
          ).pipe(
            Effect.map((value) => ({
              value,
              taskId: input.taskId,
              artifactChanges: [
                { taskId: input.taskId, artifactIds: [value.artifactId], removedArtifactIds: [] },
              ],
            })),
          ),
        ),
      ),
    deleteArtifact: (input) =>
      withDatabase(input, "sqliteTaskRepository.deleteArtifact", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.deleteArtifact", (session) =>
          deleteArtifactInDatabase(session, context.workspaceId, input, context.taskWorkflows).pipe(
            Effect.map((value) => ({
              value,
              taskId: input.taskId,
              artifactChanges: [
                {
                  taskId: input.taskId,
                  artifactIds: [input.artifactId],
                  removedArtifactIds: [input.artifactId],
                },
              ],
            })),
          ),
        ),
      ),
    clearAgentSessionsByRoles: (input) =>
      withDatabase(input, "sqliteTaskRepository.clearAgentSessionsByRoles", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.clearAgentSessionsByRoles", (session) =>
          clearAgentSessionsByRoles(session, context.workspaceId, input, now()).pipe(
            Effect.map((value) => ({ value, taskId: input.taskId })),
          ),
        ),
      ),
    deleteAgentSession: (input) =>
      withDatabase(input, "sqliteTaskRepository.deleteAgentSession", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.deleteAgentSession", (session) =>
          deleteAgentSession(session, context.workspaceId, input, now()).pipe(
            Effect.map((value) => ({ value, taskId: input.taskId })),
          ),
        ),
      ),
    clearWorkflowArtifacts: (input) =>
      withDatabase(input, "sqliteTaskRepository.clearWorkflowArtifacts", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.clearWorkflowArtifacts", (session) =>
          clearWorkflowArtifacts(
            session,
            context.workspaceId,
            input.taskId,
            input.repoPath,
            input.codes,
          ).pipe(
            Effect.map((artifactIds) => ({
              value: true,
              taskId: input.taskId,
              artifactChanges: artifactIds.length
                ? [{ taskId: input.taskId, artifactIds, removedArtifactIds: artifactIds }]
                : [],
            })),
          ),
        ),
      ),
    clearTaskArtifacts: (input) =>
      withDatabase(input, "sqliteTaskRepository.clearTaskArtifacts", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.clearTaskArtifacts", (session) =>
          clearTaskArtifacts(session, context.workspaceId, input.taskId, input.repoPath).pipe(
            Effect.map((artifactIds) => ({
              value: true,
              taskId: input.taskId,
              artifactChanges: artifactIds.length
                ? [{ taskId: input.taskId, artifactIds, removedArtifactIds: artifactIds }]
                : [],
            })),
          ),
        ),
      ),
    createTask: (input) =>
      withDatabase(input, "sqliteTaskRepository.createTask", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.createTask", (session) =>
          Effect.gen(function* () {
            const taskId = yield* insertTaskFromCreateInput({
              createdAt: now(),
              session,
              status: input.status,
              task: input.task,
              workspaceId: context.workspaceId,
            });
            const value = yield* getTaskRecord(
              session,
              context.workspaceId,
              taskId,
              input.repoPath,
              context.taskWorkflows,
            );
            return { value, taskId };
          }),
        ),
      ),
    deleteTask: (input) =>
      withDatabase(input, "sqliteTaskRepository.deleteTask", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.deleteTask", (session) =>
          Effect.gen(function* () {
            yield* requireTaskRow(session, context.workspaceId, input.taskId, input.repoPath);
            yield* deleteTasks(session, context.workspaceId, [input.taskId]);
            return { value: true, taskId: input.taskId, removed: true };
          }),
        ),
      ),
    diagnoseRepoStore(input) {
      return withDatabase(input, "sqliteTaskRepository.diagnoseRepoStore", ({ databasePath }) =>
        Effect.succeed(readyTaskStoreHealth(databasePath)),
      ).pipe(Effect.catch((cause) => Effect.succeed(blockingTaskStoreHealth(errorMessage(cause)))));
    },
    findTask: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.findTask",
        ({ session, workspaceId, taskWorkflows }) =>
          findTaskRecord(session, workspaceId, input.taskId, taskWorkflows),
      ),
    listTaskReferences: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.listTaskReferences",
        ({ session, workspaceId }) => taskReferenceCandidates(session, workspaceId),
      ),
    getTask: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.getTask",
        ({ session, workspaceId, taskWorkflows }) =>
          getTaskRecord(session, workspaceId, input.taskId, input.repoPath, taskWorkflows),
      ),
    getTaskMetadata: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.getTaskMetadata",
        ({ session, workspaceId, taskWorkflows }) =>
          Effect.gen(function* () {
            const row = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
            return yield* taskMetadata(session, row, taskWorkflows.forTask(row));
          }),
      ),
    listDirectMergeTaskIds: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.listDirectMergeTaskIds",
        ({ session, workspaceId }) => listDirectMergeTaskIdsInDatabase(session, workspaceId),
      ),
    listPullRequestSyncCandidates: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.listPullRequestSyncCandidates",
        ({ session, workspaceId, taskWorkflows }) =>
          listPullRequestSyncCandidatesInDatabase(
            session,
            workspaceId,
            hostTerminalStates(taskWorkflows),
          ),
      ),
    listAgentSessionsForTasks: (input) =>
      input.taskIds.length === 0
        ? Effect.succeed([])
        : withReadDatabase(
            input,
            "sqliteTaskRepository.listAgentSessionsForTasks",
            ({ session, workspaceId }) => listAgentSessionsForTasks(session, workspaceId, input),
          ),
    listTaskIds: (input) =>
      withReadDatabase(input, "sqliteTaskRepository.listTaskIds", ({ session, workspaceId }) =>
        listTaskIdsInDatabase(session, workspaceId),
      ),
    getTaskDelivery: (input) =>
      withReadDatabase(input, "sqliteTaskRepository.getTaskDelivery", ({ session, workspaceId }) =>
        taskDelivery(session, workspaceId, input.taskId, input.repoPath),
      ),
    getWorkflowArtifact: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.getWorkflowArtifact",
        ({ session, workspaceId, taskWorkflows }) =>
          Effect.gen(function* () {
            const task = yield* requireTaskRow(session, workspaceId, input.taskId, input.repoPath);
            const workflow = taskWorkflows.forTask(task);
            if (!workflow.artifact(input.code))
              return yield* new HostValidationError({
                field: "code",
                message: `Unknown workflow artifact ${input.code}. Use one of ${workflow.definition.artifacts.map(({ id }) => id).join(", ")}.`,
                details: { code: input.code },
              });
            const [artifact] = yield* latestWorkflowArtifactRows(
              session,
              workspaceId,
              input.taskId,
              [input.code],
            );
            return artifact ? toMetadataArtifact(artifact) : { markdown: "" };
          }),
      ),
    listMergeCandidates: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.listMergeCandidates",
        ({ session, workspaceId, taskWorkflows }) =>
          mergeCandidates(session, workspaceId, hostTerminalStates(taskWorkflows)),
      ),
    searchTasks: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.searchTasks",
        ({ session, workspaceId, taskWorkflows }) =>
          searchTasksInDatabase(session, workspaceId, input, taskWorkflows),
      ),
    listTasks: (input) =>
      withReadDatabase(
        input,
        "sqliteTaskRepository.listTasks",
        ({ session, workspaceId, taskWorkflows }) =>
          listTasksInDatabase(session, workspaceId, input, now, taskWorkflows),
      ),
    setDirectMerge: (input) =>
      withDatabase(input, "sqliteTaskRepository.setDirectMerge", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.setDirectMerge", (session) =>
          Effect.gen(function* () {
            yield* requireTaskRow(session, context.workspaceId, input.taskId, input.repoPath);
            const value = yield* setDirectMergeRecord(session, context.workspaceId, {
              ...input,
              updatedAt: now(),
            });
            return { value, taskId: input.taskId };
          }),
        ),
      ),
    setPullRequest: (input) =>
      withDatabase(input, "sqliteTaskRepository.setPullRequest", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.setPullRequest", (session) =>
          Effect.gen(function* () {
            yield* requireTaskRow(session, context.workspaceId, input.taskId, input.repoPath);
            const value = yield* setPullRequestRecord(session, context.workspaceId, {
              ...input,
              updatedAt: now(),
            });
            return { value, taskId: input.taskId };
          }),
        ),
      ),
    ...createSqliteTaskWorkflowMutations({ contextProvider: withDatabase, now }),
    updateTask: (input) =>
      withDatabase(input, "sqliteTaskRepository.updateTask", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.updateTask", (session) =>
          Effect.gen(function* () {
            const { task: value, changed } = yield* applyTaskPatch(
              session,
              context.workspaceId,
              input,
              now(),
              context.taskWorkflows,
            );
            const result: TaskMutationResult<TaskRecord> = { value };
            if (changed) result.taskId = input.taskId;
            return result;
          }),
        ),
      ),
    recordAgentSessionActivity: (input) =>
      withDatabase(input, "sqliteTaskRepository.recordAgentSessionActivity", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.recordAgentSessionActivity", (session) =>
          recordAgentSessionActivity(session, context.workspaceId, input).pipe(
            Effect.map((value) => {
              const result: TaskMutationResult<typeof value> = { value };
              if (value !== null) result.taskId = value.taskId;
              return result;
            }),
          ),
        ),
      ),
    upsertAgentSession: (input) =>
      withDatabase(input, "sqliteTaskRepository.upsertAgentSession", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.upsertAgentSession", (session) =>
          upsertAgentSession(session, context.workspaceId, input, now()).pipe(
            Effect.map((value) => ({ value, taskId: input.taskId })),
          ),
        ),
      ),
    updateAgentSessionModel: (input) =>
      withDatabase(input, "sqliteTaskRepository.updateAgentSessionModel", (context) =>
        commitTaskMutation(context, "sqliteTaskRepository.updateAgentSessionModel", (session) =>
          updateAgentSessionModel(session, context.workspaceId, input, now()).pipe(
            Effect.map((value) => ({ value, taskId: input.taskId })),
          ),
        ),
      ),
  };
};
