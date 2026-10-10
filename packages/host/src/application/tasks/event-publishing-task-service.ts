import type { TaskChangeSet } from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskSessionOwnershipCommittedError } from "../agent-sessions/task-session-ownership-error";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import type { TaskSyncService } from "./sync/task-sync-service";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "./task-mutation-progress-failure";
import type {
  TaskService,
  TaskServiceError,
  TaskServiceWithMutationProgress,
} from "./task-service";

export type CreateEventPublishingTaskServiceInput = {
  taskService: TaskServiceWithMutationProgress;
  taskSyncService: Pick<
    TaskSyncService,
    "publishExternalTaskCreated" | "publishTasksUpdated" | "syncRepoPullRequests" | "runMutation"
  >;
};

export type EventPublishingTaskService = TaskService & {
  transitionTaskDeferredPublication: (
    input: Parameters<TaskService["transitionTask"]>[0],
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

const changeForTask = (taskId: string): TaskChangeSet => ({
  taskIds: [taskId],
  removedTaskIds: [],
});

export const createEventPublishingTaskService = ({
  taskService,
  taskSyncService,
}: CreateEventPublishingTaskServiceInput): EventPublishingTaskService => {
  const agentSessionUpdateModelDeferredPublication: EventPublishingTaskService["agentSessionUpdateModelDeferredPublication"] =
    (input) =>
      taskSyncService.runMutation(
        input.repoPath,
        Effect.gen(function* () {
          const { result, statusChanges } = yield* collectTaskStatusChanges(
            taskService.agentSessionUpdateModel(input),
          );
          if (result._tag === "Failure") return yield* Effect.fail(result.failure);
          return {
            updated: result.success,
            publish: taskSyncService.runMutation(
              input.repoPath,
              taskSyncService.publishTasksUpdated(
                input.repoPath,
                changeForTask(input.taskId),
                "agent-session-update-model",
                statusChanges,
              ),
            ),
          };
        }),
      );
  const publishAfterMutation = <A>(
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    successChanges: (result: A) => TaskChangeSet = () => changes,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const { result, statusChanges } = yield* collectTaskStatusChanges(mutation);
      if (result._tag === "Failure") {
        if (result.failure instanceof TaskMutationProgressFailure) {
          yield* taskSyncService.publishTasksUpdated(
            repoPath,
            result.failure.changes,
            operation,
            statusChanges,
            result.failure.failure,
          );
          return yield* Effect.fail(result.failure.failure);
        }
        return yield* Effect.fail(result.failure);
      }
      yield* taskSyncService.publishTasksUpdated(
        repoPath,
        successChanges(result.success),
        operation,
        statusChanges,
      );
      return result.success;
    }).pipe((mutation) => taskSyncService.runMutation(repoPath, mutation));

  const publishAfterConditionalMutation = <A>(
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    mutated: (result: A) => boolean,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const { result, statusChanges } = yield* collectTaskStatusChanges(mutation);
      if (result._tag === "Failure") {
        if (result.failure instanceof TaskMutationProgressFailure) {
          yield* taskSyncService.publishTasksUpdated(
            repoPath,
            result.failure.changes,
            operation,
            statusChanges,
            result.failure.failure,
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
    }).pipe((mutation) => taskSyncService.runMutation(repoPath, mutation));

  return {
    listTasks: (input) => taskService.listTasks(input),
    listKanbanTasks: (input) => taskService.listKanbanTasks(input),
    getTaskStopImpact: (input) => taskService.getTaskStopImpact(input),
    getTaskMetadata: (input) => taskService.getTaskMetadata(input),
    agentSessionsList: (input) => taskService.agentSessionsList(input),
    agentSessionsListForTasks: (input) => taskService.agentSessionsListForTasks(input),
    transitionTaskDeferredPublication: (input) =>
      taskSyncService.runMutation(
        input.repoPath,
        Effect.gen(function* () {
          const { result, statusChanges } = yield* collectTaskStatusChanges(
            taskService.transitionTask(input),
          );
          if (result._tag === "Failure") return yield* Effect.fail(result.failure);
          return {
            task: result.success,
            publish: taskSyncService.runMutation(
              input.repoPath,
              taskSyncService.publishTasksUpdated(
                input.repoPath,
                changeForTask(input.taskId),
                "transition-task",
                statusChanges,
              ),
            ),
          };
        }),
      ),
    agentSessionUpsertDeferredPublication: (input) =>
      taskSyncService.runMutation(
        input.repoPath,
        taskService.agentSessionUpsert(input).pipe(
          Effect.map(() => ({
            publish: taskSyncService.runMutation(
              input.repoPath,
              taskSyncService.publishTasksUpdated(
                input.repoPath,
                changeForTask(input.taskId),
                "agent-session-create",
                [],
              ),
            ),
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
        (result) => result.changes,
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
      ),
    resetTask: (input) =>
      publishAfterMutation(
        "reset-task",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.resetTask(input),
      ),
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
    specGet: (input) => taskService.specGet(input),
    setSpec: (input) =>
      publishAfterMutation(
        "set-spec",
        input.repoPath,
        changeForTask(input.taskId),
        Effect.suspend(() => taskService.setSpec(input)),
      ),
    saveSpecDocument: (input) =>
      publishAfterMutation(
        "save-spec-document",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.saveSpecDocument(input),
      ),
    planGet: (input) => taskService.planGet(input),
    setPlan: (input) =>
      publishAfterMutation(
        "set-plan",
        input.repoPath,
        changeForTask(input.taskId),
        Effect.suspend(() => taskService.setPlan(input)),
        (result) => result.changes,
      ),
    savePlanDocument: (input) =>
      publishAfterMutation(
        "save-plan-document",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.savePlanDocument(input),
      ),
    qaGetReport: (input) => taskService.qaGetReport(input),
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
    qaApproved: (input) =>
      publishAfterMutation(
        "qa-approved",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.qaApproved(input),
      ),
    qaRejected: (input) =>
      publishAfterMutation(
        "qa-rejected",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.qaRejected(input),
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
        .syncRepoPullRequests(input.repoPath)
        .pipe(Effect.map((result) => ({ ok: result.ran }))),
    repoPullRequestSyncDetailed: (input) => taskService.repoPullRequestSyncDetailed(input),
  };
};
