import { Effect } from "effect";
import { cleanupMergedBuilderState } from "../support/builder-worktree-cleanup";
import {
  fetchLinkedPullRequest,
  githubPullRequestSyncPolicy,
  pullRequestRecordsMatch,
} from "../support/github-pull-requests";
import {
  requireDependencies,
  requireMergedBuilderCleanupDependencies,
  requirePullRequestSyncDependencies,
  type TaskGithubDependencyInput,
} from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskPullRequestSyncUseCases = ({
  devServerService,
  gitPort,
  githubDependencies,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
}: CreateTaskServiceInput & TaskGithubDependencyInput): Pick<
  TaskService,
  "repoPullRequestSync" | "repoPullRequestSyncDetailed"
> => {
  const repoPullRequestSyncDetailed: TaskService["repoPullRequestSyncDetailed"] = (input) =>
    Effect.gen(function* () {
      const { repoPath } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestSyncDependencies({
          githubDependencies,
          workspaceSettingsService,
        }),
      );
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const policy = yield* githubPullRequestSyncPolicy(dependencies, repoConfig);
      if (!policy.available) {
        return { ran: false, changedTaskIds: [] };
      }

      const tasks = yield* taskStore.listPullRequestSyncCandidates({
        repoPath: effectiveRepoPath,
      });
      const changedTaskIds: string[] = [];
      for (const task of tasks) {
        const pullRequest = task.pullRequest;
        if (!pullRequest) {
          continue;
        }

        const updated = yield* fetchLinkedPullRequest(
          dependencies,
          effectiveRepoPath,
          policy,
          pullRequest,
        );
        if (!updated) {
          continue;
        }

        if (updated.record.state === "merged" && task.status !== "closed") {
          const cleanupDependencies = yield* requireDependencies(() =>
            requireMergedBuilderCleanupDependencies(
              { devServerService, gitPort, settingsConfig, taskWorktreeService, terminalService },
              "repo_pull_request_sync",
            ),
          );
          yield* taskStore.setPullRequest({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            pullRequest: updated.record,
          });
          yield* cleanupMergedBuilderState(
            cleanupDependencies,
            taskStore,
            effectiveRepoPath,
            task.id,
            updated.sourceBranch,
            updated.targetBranch,
          );

          const { current, currentTasks } = yield* taskListWithCurrent(
            taskStore,
            effectiveRepoPath,
            task.id,
          );
          yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
          yield* taskStore.transitionTask({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            status: "closed",
          });
          changedTaskIds.push(task.id);
        } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
          yield* taskStore.setPullRequest({
            repoPath: effectiveRepoPath,
            taskId: task.id,
            pullRequest: updated.record,
          });
          changedTaskIds.push(task.id);
        }
      }

      return { ran: true, changedTaskIds };
    });

  return {
    repoPullRequestSync(input) {
      return Effect.gen(function* () {
        const result = yield* repoPullRequestSyncDetailed(input);
        return { ok: result.ran };
      });
    },
    repoPullRequestSyncDetailed,
  };
};
