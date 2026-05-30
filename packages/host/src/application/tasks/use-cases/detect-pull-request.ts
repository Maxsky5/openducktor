import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { loadBuilderBranchCleanup } from "../support/builder-worktree-cleanup";
import {
  findGithubPullRequestForBranch,
  requireGithubPullRequestContext,
} from "../support/github-pull-requests";
import {
  requireDependencies,
  requirePullRequestDetectionDependencies,
  type TaskGithubDependencyInput,
} from "../support/required-task-dependencies";
import { validatePullRequestManagementStatusEffect } from "../support/task-validation-effects";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskPullRequestDetectionUseCase = ({
  githubDependencies,
  taskStore,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput & TaskGithubDependencyInput): Pick<TaskService, "detectPullRequest"> => ({
  detectPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestDetectionDependencies({
          githubDependencies,
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
      const builderContext = yield* loadBuilderBranchCleanup(
        dependencies,
        current,
        effectiveRepoPath,
        taskId,
        "Pull request detection",
      );
      const githubContext = yield* requireGithubPullRequestContext(
        dependencies,
        effectiveRepoPath,
        repoConfig,
      );
      const openPullRequest = yield* findGithubPullRequestForBranch(
        dependencies,
        effectiveRepoPath,
        githubContext,
        builderContext.sourceBranch,
        "open",
      );
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

      const pullRequest = yield* findGithubPullRequestForBranch(
        dependencies,
        effectiveRepoPath,
        githubContext,
        builderContext.sourceBranch,
        "all",
      );
      if (pullRequest?.record.state === "merged") {
        return {
          outcome: "merged",
          pullRequest: pullRequest.record,
        };
      }

      return {
        outcome: "not_found",
        sourceBranch: builderContext.sourceBranch,
        targetBranch: builderContext.targetBranch,
      };
    });
  },
});
