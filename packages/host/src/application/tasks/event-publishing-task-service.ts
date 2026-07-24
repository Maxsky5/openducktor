import type { TaskChangeSet } from "@openducktor/contracts";
import { Effect } from "effect";
import type { TaskSyncService } from "./sync/task-sync-service";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type {
  TaskService,
  TaskServiceError,
  TaskServiceWithMutationProgress,
} from "./task-service";

export type CreateEventPublishingTaskServiceInput = {
  taskService: TaskServiceWithMutationProgress;
  taskSyncService: Pick<
    TaskSyncService,
    "publishExternalTaskCreated" | "publishTasksUpdated" | "syncRepoPullRequests"
  >;
};

const changeForTask = (taskId: string): TaskChangeSet => ({
  taskIds: [taskId],
  removedTaskIds: [],
});

export const createEventPublishingTaskService = ({
  taskService,
  taskSyncService,
}: CreateEventPublishingTaskServiceInput): TaskService => {
  const publishAfterMutation = <A>(
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    successChanges: (result: A) => TaskChangeSet = () => changes,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const result = yield* Effect.either(mutation);
      if (result._tag === "Left") {
        if (result.left instanceof TaskMutationProgressFailure) {
          yield* taskSyncService.publishTasksUpdated(repoPath, result.left.changes, operation);
          return yield* Effect.fail(result.left.failure);
        }
        return yield* Effect.fail(result.left);
      }
      yield* taskSyncService.publishTasksUpdated(repoPath, successChanges(result.right), operation);
      return result.right;
    });

  const publishAfterConditionalMutation = <A>(
    operation: string,
    repoPath: string,
    changes: TaskChangeSet,
    mutation: Effect.Effect<A, TaskServiceError | TaskMutationProgressFailure>,
    mutated: (result: A) => boolean,
  ): Effect.Effect<A, TaskServiceError> =>
    Effect.gen(function* () {
      const result = yield* Effect.either(mutation);
      if (result._tag === "Left") {
        if (result.left instanceof TaskMutationProgressFailure) {
          yield* taskSyncService.publishTasksUpdated(repoPath, result.left.changes, operation);
          return yield* Effect.fail(result.left.failure);
        }
        return yield* Effect.fail(result.left);
      }
      if (!mutated(result.right)) {
        return result.right;
      }
      yield* taskSyncService.publishTasksUpdated(repoPath, changes, operation);
      return result.right;
    });

  const publishSetPlan = (input: Parameters<TaskService["setPlan"]>[0]) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(taskService.setPlan(input));
      if (result._tag === "Right") {
        yield* taskSyncService.publishTasksUpdated(
          input.repoPath,
          result.right.changes,
          "set-plan",
        );
        return result.right;
      }
      if (result.left instanceof TaskMutationProgressFailure) {
        yield* taskSyncService.publishTasksUpdated(input.repoPath, result.left.changes, "set-plan");
        return yield* Effect.fail(result.left.failure);
      }
      return yield* Effect.fail(result.left);
    });

  const publishSetSpec = (input: Parameters<TaskService["setSpec"]>[0]) =>
    Effect.gen(function* () {
      const result = yield* Effect.either(taskService.setSpec(input));
      if (result._tag === "Right") {
        yield* taskSyncService.publishTasksUpdated(
          input.repoPath,
          changeForTask(input.taskId),
          "set-spec",
        );
        return result.right;
      }
      if (result.left instanceof TaskMutationProgressFailure) {
        yield* taskSyncService.publishTasksUpdated(input.repoPath, result.left.changes, "set-spec");
        return yield* Effect.fail(result.left.failure);
      }
      return yield* Effect.fail(result.left);
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
        const created = yield* taskService.createTask(input);
        yield* taskSyncService.publishExternalTaskCreated(input.repoPath, created.id);
        return created;
      }),
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
    setSpec: publishSetSpec,
    saveSpecDocument: (input) =>
      publishAfterMutation(
        "save-spec-document",
        input.repoPath,
        changeForTask(input.taskId),
        taskService.saveSpecDocument(input),
      ),
    planGet: (input) => taskService.planGet(input),
    setPlan: publishSetPlan,
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
    taskSessionBootstrapPrepare: (input) => taskService.taskSessionBootstrapPrepare(input),
    taskSessionBootstrapComplete: (input) =>
      publishAfterMutation(
        "task-session-bootstrap-complete",
        input.repoPath,
        changeForTask(input.taskId),
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
