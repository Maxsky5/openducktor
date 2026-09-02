import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import {
  requireDependencies,
  requirePullRequestDetectionDependencies,
} from "../support/required-task-dependencies";
import { validatePullRequestManagementStatusEffect } from "../support/task-validation-effects";
import { loadTaskBranchCleanup } from "../support/task-worktree-cleanup";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskPullRequestDetectionUseCase = ({
  gitPort,
  gitProviderResolver,
  taskStore,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "detectPullRequest"> => ({
  detectPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestDetectionDependencies({
          gitPort,
          gitProviderResolver,
          taskWorktreeService,
          workspaceSettingsService,
        }),
      );
      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* validatePullRequestManagementStatusEffect(current.status);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      if (metadata.pullRequest !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task ${taskId} already has a linked pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }
      if (metadata.directMerge !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }

      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const taskContext = yield* loadTaskBranchCleanup(
        dependencies,
        current,
        effectiveRepoPath,
        taskId,
        "Pull request detection",
      );
      const provider = yield* dependencies.gitProviderResolver.resolve(repoConfig);
      const pullRequests = yield* provider.pullRequests();
      const openPullRequest = yield* pullRequests.findByBranch({
        repoConfig,
        sourceBranch: taskContext.sourceBranch,
        state: "open",
      });
      if (openPullRequest !== undefined) {
        yield* taskStore.setPullRequest({
          repoPath: effectiveRepoPath,
          taskId,
          pullRequest: openPullRequest.record,
        });
        return {
          outcome: "linked",
          pullRequest: openPullRequest.record,
        };
      }

      const pullRequest = yield* pullRequests.findByBranch({
        repoConfig,
        sourceBranch: taskContext.sourceBranch,
        state: "all",
      });
      if (pullRequest?.record.state === "merged") {
        return {
          outcome: "merged",
          pullRequest: pullRequest.record,
        };
      }

      return {
        outcome: "not_found",
        sourceBranch: taskContext.sourceBranch,
        targetBranch: taskContext.targetBranch,
      };
    });
  },
});
