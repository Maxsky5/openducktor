import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import { createTaskCleanupProgressState } from "../support/task-cleanup-progress";
import { runTaskRuntimeCleanup } from "../support/task-cleanup-support";
import { completeTaskClosure } from "../support/task-closure";
import { ensureNoDirectMergeEffect } from "../support/direct-merge-block";
import { requireEffect } from "../support/task-workflow-events";
import { applyEffect, enrichTask } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskReviewUseCases = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskSessionLifecycleCoordinator,
  terminalService,
}: CreateTaskServiceInput): Pick<
  TaskServiceWithMutationProgress,
  "humanRequestChanges" | "humanApprove"
> => ({
  humanRequestChanges(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      yield* ensureNoDirectMergeEffect({
        operation: "human_request_changes",
        repoPath,
        taskId,
        directMerge: metadata.directMerge,
      });

      return yield* applyEffect(
        taskStore,
        taskWorkflows.forRepo(repoPath),
        { repoPath, taskId },
        "review.request_changes",
      );
    });
  },

  humanApprove(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const workflow = taskWorkflows.forRepo(repoPath);
      const decision = yield* requireEffect(workflow, "review.approve", current);
      if (decision.kind === "unchanged") {
        return enrichTask(workflow, current);
      }
      if (!terminalService) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "task dependency",
            message: "Terminal service is required for human_approve.",
          }),
        );
      }
      const updated = yield* completeTaskClosure({
        cleanup: Effect.gen(function* () {
          const latest = yield* taskStore.getTask({ repoPath, taskId });
          yield* requireEffect(workflow, "review.approve", latest);
          const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
          yield* ensureNoDirectMergeEffect({
            operation: "human_approve",
            repoPath,
            taskId,
            directMerge: metadata.directMerge,
          });
          yield* runTaskRuntimeCleanup({
            progress: createTaskCleanupProgressState(),
            repoPath,
            taskIds: [taskId],
            terminalService,
          });
        }),
        gitPort,
        operation: "approve task",
        repoPath,
        decision,
        taskId,
        taskSessionLifecycleCoordinator,
        taskStore,
      });

      return enrichTask(workflow, updated);
    });
  },
});
