import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import {
  canSkipRelinkedPullRequestCleanup,
  cleanupMergedBuilderState,
  loadBuilderBranchCleanup,
} from "../support/builder-worktree-cleanup";
import {
  requireDependencies,
  requireLinkMergedPullRequestDependencies,
} from "../support/required-task-dependencies";
import {
  createTaskCleanupProgressState,
  runTaskRuntimeCleanup,
} from "../support/task-cleanup-support";
import { completeTaskClosure } from "../support/task-closure";
import {
  validatePullRequestManagementStatusEffect,
  validateTaskTransitionEffect,
} from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskLinkMergedPullRequestUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "linkMergedPullRequest"> => ({
  linkMergedPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, pullRequest } = input;

      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const sameExistingPullRequest =
        metadata.pullRequest?.providerId === pullRequest.providerId &&
        metadata.pullRequest.number === pullRequest.number &&
        metadata.pullRequest.state === "merged";
      if (current.status === "closed" && sameExistingPullRequest) {
        return enrichTask(current, currentTasks);
      }

      const dependencies = yield* requireDependencies(() =>
        requireLinkMergedPullRequestDependencies(
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          workspaceSettingsService,
        ),
      );
      yield* validatePullRequestManagementStatusEffect(current.status);
      if (metadata.directMerge !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (pullRequest.state !== "merged") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "pullRequest",
            message: `Task ${taskId} can only link a merged pull request from detection results.`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (metadata.pullRequest !== undefined && !sameExistingPullRequest) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task ${taskId} already has a linked pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }

      let cleanup: { sourceBranch: string; targetBranch: string } | null = null;
      if (metadata.pullRequest === undefined) {
        cleanup = yield* loadBuilderBranchCleanup(
          dependencies,
          current,
          repoPath,
          taskId,
          "Pull request linking",
        );
      } else {
        const cleanupResult = yield* Effect.either(
          loadBuilderBranchCleanup(dependencies, current, repoPath, taskId, "Pull request linking"),
        );
        if (cleanupResult._tag === "Right") {
          cleanup = cleanupResult.right;
        } else {
          const message = errorMessage(cleanupResult.left);
          if (!canSkipRelinkedPullRequestCleanup(message)) {
            return yield* Effect.fail(cleanupResult.left);
          }
        }
      }

      yield* taskStore.setPullRequest({ repoPath, taskId, pullRequest });
      yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
      const cleanupEffect = cleanup
        ? cleanupMergedBuilderState(
            dependencies,
            taskStore,
            repoPath,
            taskId,
            cleanup.sourceBranch,
            cleanup.targetBranch,
          )
        : runTaskRuntimeCleanup({
            devServerService: dependencies.devServerService,
            progress: createTaskCleanupProgressState(),
            repoPath,
            taskIds: [taskId],
            terminalService: dependencies.terminalService,
          });
      const task = yield* completeTaskClosure({
        cleanup: cleanupEffect,
        repoPath,
        taskId,
        taskStore,
      });
      const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

      return enrichTask(task, nextTasks);
    });
  },
});
