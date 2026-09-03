import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import { requireWorktreeFiles } from "../../git/git-service-inputs";
import { requirePullRequestProviderMatch } from "../../pull-requests/pull-request-provider-match";
import {
  requireDependencies,
  requireLinkMergedPullRequestDependencies,
  requirePullRequestLinkDependencies,
} from "../support/required-task-dependencies";
import { createTaskCleanupProgressState } from "../support/task-cleanup-progress";
import { runTaskRuntimeCleanup } from "../support/task-cleanup-support";
import { completeTaskClosure } from "../support/task-closure";
import {
  validatePullRequestManagementStatusEffect,
  validateTaskTransitionEffect,
} from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import {
  canSkipRelinkedPullRequestCleanup,
  cleanupMergedTaskState,
  loadTaskBranchCleanup,
} from "../support/task-worktree-cleanup";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

type TaskBranchCleanup = {
  sourceBranch: string;
  targetBranch: string;
};

export const createTaskLinkMergedPullRequestUseCase = ({
  devServerService,
  gitPort,
  gitProviderResolver,
  taskStore,
  settingsConfig,
  taskSessionBootstrapCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
}: CreateTaskServiceInput) => ({
  linkMergedPullRequest(input: Parameters<TaskService["linkMergedPullRequest"]>[0]) {
    return Effect.gen(function* () {
      const { repoPath, taskId, pullRequest } = input;

      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const sameExistingPullRequest =
        metadata.pullRequest?.providerId === pullRequest.providerId &&
        metadata.pullRequest.number === pullRequest.number &&
        metadata.pullRequest.state === "merged";

      const providerDependencies = yield* requireDependencies(() =>
        requirePullRequestLinkDependencies({
          gitProviderResolver,
          workspaceSettingsService,
        }),
      );
      const repoConfig =
        yield* providerDependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const provider = yield* providerDependencies.gitProviderResolver.resolve(repoConfig);
      const configuredProviderId = provider.getDescriptor().id;
      yield* requirePullRequestProviderMatch({
        configuredProviderId,
        linkedProviderId: pullRequest.providerId,
      });
      if (metadata.pullRequest !== undefined) {
        yield* requirePullRequestProviderMatch({
          configuredProviderId,
          linkedProviderId: metadata.pullRequest.providerId,
        });
      }
      if (current.status === "closed" && sameExistingPullRequest) {
        return enrichTask(current, currentTasks);
      }

      const dependencies = yield* requireDependencies(() =>
        requireLinkMergedPullRequestDependencies({
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          worktreeFiles,
          workspaceSettingsService,
        }),
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

      let cleanup: TaskBranchCleanup | null = null;
      if (metadata.pullRequest === undefined) {
        cleanup = yield* loadTaskBranchCleanup(
          dependencies,
          current,
          repoPath,
          taskId,
          "Pull request linking",
        );
      } else {
        const cleanupResult = yield* Effect.either(
          loadTaskBranchCleanup(dependencies, current, repoPath, taskId, "Pull request linking"),
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

      if (cleanup !== null) {
        yield* requireWorktreeFiles(dependencies.worktreeFiles);
      }
      yield* taskStore.setPullRequest({ repoPath, taskId, pullRequest });
      const postLink = yield* Effect.either(
        Effect.gen(function* () {
          yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
          const cleanupEffect = cleanup
            ? cleanupMergedTaskState(
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
          return yield* completeTaskClosure({
            cleanup: cleanupEffect,
            gitPort: dependencies.gitPort,
            operation: "link merged pull request",
            repoPath,
            taskId,
            taskSessionBootstrapCoordinator,
            taskStore,
          });
        }),
      );
      if (postLink._tag === "Left") {
        return yield* Effect.fail(
          createTaskMutationProgressFailure("link-merged-pull-request", taskId, postLink.left),
        );
      }
      const task = postLink.right;
      const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

      return enrichTask(task, nextTasks);
    });
  },
});
