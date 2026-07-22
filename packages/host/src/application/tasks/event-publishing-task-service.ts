import { Effect } from "effect";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import { RepoPullRequestSyncPartialFailure } from "./repo-pull-request-sync-partial-failure";
import { SetPlanProgressFailure } from "./set-plan-progress-failure";
import type { TaskSyncService } from "./sync/task-sync-service";
import type {
  TaskService,
  TaskServiceError,
  TaskServiceWithMutationProgress,
} from "./task-service";

export type CreateEventPublishingTaskServiceInput = {
  taskService: TaskServiceWithMutationProgress;
  taskSyncService: Pick<TaskSyncService, "publishExternalTaskCreated" | "publishTasksUpdated">;
};

const uniqueTaskIds = (taskIds: string[]): string[] => [...new Set(taskIds)];

/**
 * Adds cache-invalidation events to the durable task mutations exposed by TaskService.
 *
 * The primary task id is deliberately used for mutations whose related task ids are not
 * available from their public inputs/results. The client invalidates the repository task list.
 */
export const createEventPublishingTaskService = ({
  taskService,
  taskSyncService,
}: CreateEventPublishingTaskServiceInput): TaskService => {
  const publishTasksUpdated = (repoPath: string, taskIds: string[]) => {
    const changedTaskIds = uniqueTaskIds(taskIds);
    return changedTaskIds.length === 0
      ? Effect.void
      : taskSyncService.publishTasksUpdated(repoPath, changedTaskIds);
  };

  const publishAfterMutation = <A>(
    operation: string,
    repoPath: string,
    failureTaskIds: string[],
    mutation: Effect.Effect<A, TaskServiceError>,
    successfulTaskIds: (result: A) => string[] = () => failureTaskIds,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const mutationResult = yield* Effect.either(mutation);
      const taskIds =
        mutationResult._tag === "Left" ? failureTaskIds : successfulTaskIds(mutationResult.right);
      const publicationResult = yield* Effect.either(publishTasksUpdated(repoPath, taskIds));
      if (mutationResult._tag === "Left") {
        if (publicationResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: `task-event-publishing.${operation}`,
              message: `${errorMessage(mutationResult.left)}\nTask cache invalidation failed: ${errorMessage(publicationResult.left)}`,
              cause: mutationResult.left,
              details: {
                mutationFailure: mutationResult.left,
                publicationFailure: publicationResult.left,
                repoPath,
                taskIds: uniqueTaskIds(taskIds),
              },
            }),
          );
        }
        return yield* Effect.fail(mutationResult.left);
      }
      if (publicationResult._tag === "Left") {
        return yield* Effect.fail(publicationResult.left);
      }
      return mutationResult.right;
    });

  const publishAfterConditionalMutation = <A>(
    operation: string,
    repoPath: string,
    taskIds: string[],
    mutation: Effect.Effect<A, TaskServiceError>,
    mutated: (result: A) => boolean,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const mutationResult = yield* Effect.either(mutation);
      const shouldPublish = mutationResult._tag === "Left" || mutated(mutationResult.right);
      if (!shouldPublish) {
        return mutationResult.right;
      }
      const publicationResult = yield* Effect.either(publishTasksUpdated(repoPath, taskIds));
      if (mutationResult._tag === "Left") {
        if (publicationResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: `task-event-publishing.${operation}`,
              message: `${errorMessage(mutationResult.left)}\nTask cache invalidation failed: ${errorMessage(publicationResult.left)}`,
              cause: mutationResult.left,
              details: {
                mutationFailure: mutationResult.left,
                publicationFailure: publicationResult.left,
                repoPath,
                taskIds: uniqueTaskIds(taskIds),
              },
            }),
          );
        }
        return yield* Effect.fail(mutationResult.left);
      }
      if (publicationResult._tag === "Left") {
        return yield* Effect.fail(publicationResult.left);
      }
      return mutationResult.right;
    });

  return {
    listTasks: (input) => taskService.listTasks(input),
    getTaskMetadata: (input) => taskService.getTaskMetadata(input),
    agentSessionsList: (input) => taskService.agentSessionsList(input),
    agentSessionsListForTasks: (input) => taskService.agentSessionsListForTasks(input),
    agentSessionUpsert: (input) => taskService.agentSessionUpsert(input),
    agentSessionDelete: (input) => taskService.agentSessionDelete(input),
    getApprovalContext: (input) => taskService.getApprovalContext(input),
    detectPullRequest: (input) =>
      publishAfterConditionalMutation(
        "detect-pull-request",
        input.repoPath,
        [input.taskId],
        taskService.detectPullRequest(input),
        (result) => result.outcome === "linked",
      ),
    linkPullRequest: (input) =>
      publishAfterMutation(
        "link-pull-request",
        input.repoPath,
        [input.taskId],
        taskService.linkPullRequest(input),
      ),
    upsertPullRequest: (input) =>
      publishAfterMutation(
        "upsert-pull-request",
        input.repoPath,
        [input.taskId],
        taskService.upsertPullRequest(input),
      ),
    unlinkPullRequest: (input) =>
      publishAfterMutation(
        "unlink-pull-request",
        input.repoPath,
        [input.taskId],
        taskService.unlinkPullRequest(input),
      ),
    linkMergedPullRequest: (input) =>
      publishAfterMutation(
        "link-merged-pull-request",
        input.repoPath,
        [input.taskId],
        taskService.linkMergedPullRequest(input),
      ),
    directMerge: (input) =>
      publishAfterConditionalMutation(
        "direct-merge",
        input.repoPath,
        [input.taskId],
        taskService.directMerge(input),
        (result) => result.outcome === "completed",
      ),
    completeDirectMerge: (input) =>
      publishAfterMutation(
        "complete-direct-merge",
        input.repoPath,
        [input.taskId],
        taskService.completeDirectMerge(input),
      ),
    createTask: (input) =>
      Effect.gen(function* () {
        const created = yield* taskService.createTask(input);
        yield* taskSyncService.publishExternalTaskCreated(input.repoPath, created.id);
        return created;
      }),
    deleteTask: (input) =>
      publishAfterMutation(
        "delete-task",
        input.repoPath,
        [input.taskId],
        taskService.deleteTask(input),
        (result) => result.affectedTaskIds,
      ),
    closeTask: (input) =>
      publishAfterMutation(
        "close-task",
        input.repoPath,
        [input.taskId],
        taskService.closeTask(input),
      ),
    resetImplementation: (input) =>
      publishAfterMutation(
        "reset-implementation",
        input.repoPath,
        [input.taskId],
        taskService.resetImplementation(input),
      ),
    resetTask: (input) =>
      publishAfterMutation(
        "reset-task",
        input.repoPath,
        [input.taskId],
        taskService.resetTask(input),
      ),
    updateTask: (input) =>
      publishAfterMutation(
        "update-task",
        input.repoPath,
        [input.taskId],
        taskService.updateTask(input),
      ),
    transitionTask: (input) =>
      publishAfterMutation(
        "transition-task",
        input.repoPath,
        [input.taskId],
        taskService.transitionTask(input),
      ),
    specGet: (input) => taskService.specGet(input),
    setSpec: (input) =>
      publishAfterMutation("set-spec", input.repoPath, [input.taskId], taskService.setSpec(input)),
    saveSpecDocument: (input) =>
      publishAfterMutation(
        "save-spec-document",
        input.repoPath,
        [input.taskId],
        taskService.saveSpecDocument(input),
      ),
    planGet: (input) => taskService.planGet(input),
    setPlan: (input) =>
      Effect.gen(function* () {
        const mutationResult = yield* Effect.either(taskService.setPlan(input));
        const progressFailure =
          mutationResult._tag === "Left" && mutationResult.left instanceof SetPlanProgressFailure
            ? mutationResult.left
            : null;
        const taskIds =
          mutationResult._tag === "Right"
            ? mutationResult.right.affectedTaskIds
            : (progressFailure?.affectedTaskIds ?? [input.taskId]);
        const publicationResult = yield* Effect.either(
          publishTasksUpdated(input.repoPath, taskIds),
        );
        if (mutationResult._tag === "Right") {
          if (publicationResult._tag === "Left") {
            return yield* Effect.fail(publicationResult.left);
          }
          return mutationResult.right;
        }
        const failure =
          mutationResult.left instanceof SetPlanProgressFailure
            ? mutationResult.left.failure
            : mutationResult.left;
        if (publicationResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task-event-publishing.set-plan",
              message: `${errorMessage(failure)}\nTask cache invalidation failed: ${errorMessage(publicationResult.left)}`,
              cause: failure,
              details: {
                mutationFailure: failure,
                publicationFailure: publicationResult.left,
                repoPath: input.repoPath,
                taskIds: uniqueTaskIds(taskIds),
              },
            }),
          );
        }
        return yield* Effect.fail(failure);
      }),
    savePlanDocument: (input) =>
      publishAfterMutation(
        "save-plan-document",
        input.repoPath,
        [input.taskId],
        taskService.savePlanDocument(input),
      ),
    qaGetReport: (input) => taskService.qaGetReport(input),
    buildBlocked: (input) =>
      publishAfterMutation(
        "build-blocked",
        input.repoPath,
        [input.taskId],
        taskService.buildBlocked(input),
      ),
    buildStart: (input) =>
      publishAfterMutation(
        "build-start",
        input.repoPath,
        [input.taskId],
        taskService.buildStart(input),
      ),
    taskSessionBootstrapPrepare: (input) => taskService.taskSessionBootstrapPrepare(input),
    taskSessionBootstrapComplete: (input) =>
      publishAfterMutation(
        "task-session-bootstrap-complete",
        input.repoPath,
        [input.taskId],
        taskService.taskSessionBootstrapComplete(input),
      ),
    taskSessionBootstrapAbort: (input) => taskService.taskSessionBootstrapAbort(input),
    taskSessionStartupLeasePrepare: (input) => taskService.taskSessionStartupLeasePrepare(input),
    taskSessionStartupLeaseComplete: (input) => taskService.taskSessionStartupLeaseComplete(input),
    taskSessionStartupLeaseAbort: (input) => taskService.taskSessionStartupLeaseAbort(input),
    buildResumed: (input) =>
      publishAfterMutation(
        "build-resumed",
        input.repoPath,
        [input.taskId],
        taskService.buildResumed(input),
      ),
    buildCompleted: (input) =>
      publishAfterMutation(
        "build-completed",
        input.repoPath,
        [input.taskId],
        taskService.buildCompleted(input),
      ),
    qaApproved: (input) =>
      publishAfterMutation(
        "qa-approved",
        input.repoPath,
        [input.taskId],
        taskService.qaApproved(input),
      ),
    qaRejected: (input) =>
      publishAfterMutation(
        "qa-rejected",
        input.repoPath,
        [input.taskId],
        taskService.qaRejected(input),
      ),
    humanRequestChanges: (input) =>
      publishAfterMutation(
        "human-request-changes",
        input.repoPath,
        [input.taskId],
        taskService.humanRequestChanges(input),
      ),
    humanApprove: (input) =>
      publishAfterMutation(
        "human-approve",
        input.repoPath,
        [input.taskId],
        taskService.humanApprove(input),
      ),
    repoPullRequestSync: (input) =>
      Effect.gen(function* () {
        const syncResult = yield* Effect.either(taskService.repoPullRequestSyncDetailed(input));
        if (syncResult._tag === "Right") {
          yield* publishTasksUpdated(input.repoPath, syncResult.right.changedTaskIds);
          return { ok: syncResult.right.ran };
        }
        if (!(syncResult.left instanceof RepoPullRequestSyncPartialFailure)) {
          return yield* Effect.fail(syncResult.left);
        }
        const publicationResult = yield* Effect.either(
          publishTasksUpdated(input.repoPath, syncResult.left.changedTaskIds),
        );
        if (publicationResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "task-event-publishing.repo-pull-request-sync",
              message: `${errorMessage(syncResult.left.failure)}\nTask cache invalidation failed: ${errorMessage(publicationResult.left)}`,
              cause: syncResult.left.failure,
              details: {
                mutationFailure: syncResult.left.failure,
                publicationFailure: publicationResult.left,
                repoPath: input.repoPath,
                taskIds: uniqueTaskIds(syncResult.left.changedTaskIds),
              },
            }),
          );
        }
        return yield* Effect.fail(syncResult.left.failure);
      }),
    repoPullRequestSyncDetailed: (input) => taskService.repoPullRequestSyncDetailed(input),
  };
};
