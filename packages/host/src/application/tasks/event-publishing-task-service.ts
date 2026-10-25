import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { TaskChangeSet } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskSessionOwnershipCommittedError } from "../agent-sessions/task-session-ownership-error";
import { removedArtifactChanges, workflowArtifactChange } from "./artifact-changes";
import {
  createArtifactPublishingMethods,
  type ArtifactPublishingMethods,
} from "./artifact-publication";
import type { TaskSyncService } from "./sync/task-sync-service";
import type { TaskMutationOperation } from "./task-mutation-operation";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "./task-mutation-progress-failure";
import { createMutationPublisher } from "./task-mutation-publisher";
import type {
  TaskService,
  TaskServiceError,
  TaskServiceWithMutationProgress,
} from "./task-service";

export type CreateEventPublishingTaskServiceInput = {
  taskService: TaskServiceWithMutationProgress;
  taskWorkflows: TaskWorkflowResolver;
  taskSyncService: Pick<
    TaskSyncService,
    | "runStatusMutation"
    | "publishExternalTaskCreated"
    | "publishTasksUpdated"
    | "syncRepoPullRequests"
    | "runMutation"
  >;
};

export type EventPublishingTaskService = Omit<TaskService, keyof ArtifactPublishingMethods> &
  ArtifactPublishingMethods & {
    applyStartEventDeferredPublication: (
      input: Parameters<TaskService["applyStartEvent"]>[0],
    ) => Effect.Effect<
      {
        task: import("@openducktor/contracts").TaskCard;
        publish: Effect.Effect<void, TaskServiceError>;
      },
      TaskServiceError
    >;
    agentSessionUpsertDeferredPublication: (
      input: Parameters<TaskService["agentSessionUpsert"]>[0],
    ) => Effect.Effect<{ publish: Effect.Effect<void, TaskServiceError> }, TaskServiceError>;
    agentSessionUpdateModelDeferredPublication: (
      input: Parameters<TaskService["agentSessionUpdateModel"]>[0],
    ) => Effect.Effect<
      { updated: boolean; publish: Effect.Effect<void, TaskServiceError> },
      TaskServiceError
    >;
  };

export const createEventPublishingTaskService = ({
  taskService,
  taskWorkflows,
  taskSyncService,
}: CreateEventPublishingTaskServiceInput): EventPublishingTaskService => {
  const agentSessionUpdateModelDeferredPublication: EventPublishingTaskService["agentSessionUpdateModelDeferredPublication"] =
    (input) =>
      taskSyncService.runStatusMutation(
        input.repoPath,
        "agent-session-update-model",
        taskService.agentSessionUpdateModel(input),
        ({ result, statusChanges }) =>
          result._tag === "Failure"
            ? Effect.fail(result.failure)
            : Effect.succeed({
                updated: result.success,
                publish: taskSyncService
                  .runMutation(
                    input.repoPath,
                    taskSyncService.publishTasksUpdated(
                      input.repoPath,
                      changeForTask(input.taskId),
                      "agent-session-update-model",
                      statusChanges,
                    ),
                  )
                  .pipe(Effect.asVoid),
              }),
      );
  const publishMutation = createMutationPublisher({ taskSyncService });

  const publishAfterMutation = <A>(
    ...args: Parameters<typeof publishMutation<A>>
  ): Effect.Effect<A, TaskServiceError> =>
    publishMutation(...args).pipe(Effect.map(({ value }) => value));

  const publishAfterConditionalMutation = <A>(
    operation: TaskMutationOperation,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    mutated: (result: A) => boolean,
  ): Effect.Effect<A, TaskServiceError> =>
    taskSyncService.runStatusMutation(repoPath, operation, mutation, ({ result, statusChanges }) =>
      Effect.gen(function* () {
        if (result._tag === "Failure") {
          if (result.failure instanceof TaskMutationProgressFailure) {
            yield* taskSyncService.publishTasksUpdated(
              repoPath,
              result.failure.changes,
              operation,
              statusChanges,
              result.failure.failure,
              result.failure.artifactChanges,
            );
            return yield* Effect.fail(result.failure.failure);
          }
          return yield* Effect.fail(result.failure);
        }
        if (!mutated(result.success)) {
          return result.success;
        }
        yield* taskSyncService.publishTasksUpdated(repoPath, changes, operation, statusChanges);
        return result.success;
      }),
    );

  return {
    ...createArtifactPublishingMethods(taskService, publishMutation),
    findTask: (input) => taskService.findTask(input),
    listTaskReferences: (input) => taskService.listTaskReferences(input),
    listTasks: (input) => taskService.listTasks(input),
    listKanbanTasks: (input) => taskService.listKanbanTasks(input),
    listTaskIds: (input) => taskService.listTaskIds(input),
    getTaskStopImpact: (input) => taskService.getTaskStopImpact(input),
    getTaskMetadata: (input) => taskService.getTaskMetadata(input),
    agentSessionsList: (input) => taskService.agentSessionsList(input),
    agentSessionsListForTasks: (input) => taskService.agentSessionsListForTasks(input),
    applyStartEventDeferredPublication: (input) =>
      taskSyncService.runStatusMutation(
        input.repoPath,
        "apply-task-event",
        taskService.applyStartEvent(input),
        ({ result, statusChanges }) =>
          result._tag === "Failure"
            ? Effect.fail(result.failure)
            : Effect.succeed({
                task: result.success,
                publish: taskSyncService
                  .runMutation(
                    input.repoPath,
                    taskSyncService.publishTasksUpdated(
                      input.repoPath,
                      changeForTask(input.taskId),
                      "apply-task-event",
                      statusChanges,
                    ),
                  )
                  .pipe(Effect.asVoid),
              }),
      ),
    agentSessionUpsertDeferredPublication: (input) =>
      taskSyncService.runMutation(
        input.repoPath,
        taskService.agentSessionUpsert(input).pipe(
          Effect.map(() => ({
            publish: taskSyncService
              .runMutation(
                input.repoPath,
                taskSyncService.publishTasksUpdated(
                  input.repoPath,
                  changeForTask(input.taskId),
                  "agent-session-create",
                  [],
                ),
              )
              .pipe(Effect.asVoid),
          })),
        ),
      ),
    agentSessionUpsert: (input) =>
      taskSyncService.runMutation(
        input.repoPath,
        taskService.agentSessionUpsert(input).pipe(
          Effect.tap(() =>
            taskSyncService
              .publishTasksUpdated(
                input.repoPath,
                changeForTask(input.taskId),
                "agent-session-create",
                [],
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new TaskSessionOwnershipCommittedError({
                      operation: "task-session.publish-ownership",
                      message: cause.message,
                      cause,
                    }),
                ),
              ),
          ),
        ),
      ),
    agentSessionUpdateModel: (input) =>
      agentSessionUpdateModelDeferredPublication(input).pipe(
        Effect.flatMap(({ updated, publish }) => publish.pipe(Effect.as(updated))),
      ),
    agentSessionUpdateModelDeferredPublication,
    agentSessionDelete: (input) =>
      publishAfterMutation(
        "agent-session-delete",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.agentSessionDelete(input),
      ),
    getApprovalContext: (input) => taskService.getApprovalContext(input),
    detectPullRequest: (input) =>
      publishAfterConditionalMutation(
        "detect-pull-request",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.detectPullRequest(input),
        (result) => result.outcome === "linked",
      ),
    linkPullRequest: (input) =>
      publishAfterMutation(
        "link-pull-request",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.linkPullRequest(input),
      ),
    upsertPullRequest: (input) =>
      publishAfterMutation(
        "upsert-pull-request",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.upsertPullRequest(input),
      ),
    unlinkPullRequest: (input) =>
      publishAfterMutation(
        "unlink-pull-request",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.unlinkPullRequest(input),
      ),
    linkMergedPullRequest: (input) =>
      publishAfterMutation(
        "link-merged-pull-request",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.linkMergedPullRequest(input),
      ),
    directMerge: (input) =>
      publishAfterConditionalMutation(
        "direct-merge",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.directMerge(input),
        (result) => result.outcome === "completed",
      ),
    completeDirectMerge: (input) =>
      publishAfterMutation(
        "complete-direct-merge",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.completeDirectMerge(input),
      ),
    createTask: (input) =>
      Effect.gen(function* () {
        const result = yield* Effect.result(taskService.createTask(input));
        if (result._tag === "Failure") {
          if (result.failure instanceof TaskCreationProgressFailure) {
            yield* taskSyncService.publishExternalTaskCreated(
              input.repoPath,
              result.failure.createdTask,
            );
            return yield* Effect.fail(result.failure.failure);
          }
          return yield* Effect.fail(result.failure);
        }
        yield* taskSyncService.publishExternalTaskCreated(input.repoPath, result.success);
        return result.success;
      }).pipe((mutation) => taskSyncService.runMutation(input.repoPath, mutation)),
    deleteTask: (input) =>
      publishAfterMutation(
        "delete-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.deleteTask(input),
        { changes: (result) => result.changes },
      ),
    closeTask: (input) =>
      publishAfterMutation(
        "close-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.closeTask(input),
      ),
    resetImplementation: (input) =>
      publishAfterMutation(
        "reset-implementation",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.resetImplementation(input),
        {
          artifactChanges: () =>
            taskWorkflows
              .forRepo(input.repoPath)
              .reviewArtifactCodes.map((code) => workflowArtifactChange(input.taskId, code, true)),
        },
      ),
    resetTask: (input) =>
      publishAfterMutation(
        "reset-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.resetTask(input),
        {
          artifactChanges: (result) =>
            removedArtifactChanges(input.taskId, result.removedArtifactIds),
        },
      ).pipe(Effect.map(({ task }) => task)),
    updateTask: (input) =>
      publishAfterMutation(
        "update-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.updateTask(input),
      ),
    transitionTask: (input) =>
      publishAfterMutation(
        "transition-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.transitionTask(input),
      ),
    applyTaskEvent: (input) =>
      publishAfterMutation(
        "apply-task-event",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.applyTaskEvent(input),
      ),
    applyStartEvent: (input) =>
      publishAfterMutation(
        "apply-task-event",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.applyStartEvent(input),
      ),
    buildBlocked: (input) =>
      publishAfterMutation(
        "build-blocked",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.buildBlocked(input),
      ),
    buildStart: (input) =>
      publishAfterMutation(
        "build-start",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.buildStart(input),
      ),
    buildResumed: (input) =>
      publishAfterMutation(
        "build-resumed",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.buildResumed(input),
      ),
    buildCompleted: (input) =>
      publishAfterMutation(
        "build-completed",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.buildCompleted(input),
      ),
    humanRequestChanges: (input) =>
      publishAfterMutation(
        "human-request-changes",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.humanRequestChanges(input),
      ),
    humanApprove: (input) =>
      publishAfterMutation(
        "human-approve",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.humanApprove(input),
      ),
    repoPullRequestSync: (input) =>
      taskSyncService
        .syncRepoPullRequests(input.repoPath, input.expectedWorkspaceId)
        .pipe(
          Effect.map((result) =>
            result.ran
              ? { ok: true as const }
              : { ok: false as const, reason: result.reason, message: result.message },
          ),
        ),
    repoPullRequestSyncDetailed: (input) => taskService.repoPullRequestSyncDetailed(input),
  };
};

const changeForTask = (taskId: string): TaskChangeSet => ({
  taskIds: [taskId],
  removedTaskIds: [],
});
