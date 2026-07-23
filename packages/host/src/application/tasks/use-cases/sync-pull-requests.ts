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
import { completeTaskClosure } from "../support/task-closure";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { taskListWithCurrent } from "../support/task-workflow-helpers";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { CreateTaskServiceInput, TaskService, TaskServiceError } from "../task-service";

export const createTaskPullRequestSyncUseCases = ({
  devServerService,
  gitPort,
  githubDependencies,
  taskStore,
  settingsConfig,
  taskSessionBootstrapCoordinator,
  taskWorktreeService,
  terminalService,
  workspaceSettingsService,
}: CreateTaskServiceInput & TaskGithubDependencyInput): Pick<
  TaskService,
  "repoPullRequestSync" | "repoPullRequestSyncDetailed"
> => {
  const repoPullRequestSyncDetailed: TaskService["repoPullRequestSyncDetailed"] = (input) => {
    const changedTaskIds = new Set<string>();
    const sync: Effect.Effect<{ ran: boolean; changedTaskIds: string[] }, TaskServiceError> =
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
            changedTaskIds.add(task.id);
            const { current, currentTasks } = yield* taskListWithCurrent(
              taskStore,
              effectiveRepoPath,
              task.id,
            );
            yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
            yield* completeTaskClosure({
              cleanup: cleanupMergedBuilderState(
                cleanupDependencies,
                taskStore,
                effectiveRepoPath,
                task.id,
                updated.sourceBranch,
                updated.targetBranch,
              ),
              gitPort: cleanupDependencies.gitPort,
              operation: "sync merged pull request",
              repoPath: effectiveRepoPath,
              taskId: task.id,
              taskSessionBootstrapCoordinator,
              taskStore,
            });
          } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
            yield* taskStore.setPullRequest({
              repoPath: effectiveRepoPath,
              taskId: task.id,
              pullRequest: updated.record,
            });
            changedTaskIds.add(task.id);
          }
        }

        return { ran: true, changedTaskIds: [...changedTaskIds] };
      });
    return Effect.gen(function* () {
      const result = yield* Effect.either(sync);
      if (result._tag === "Right") {
        return result.right;
      }
      const failure = result.left;
      if (changedTaskIds.size === 0) {
        return yield* Effect.fail(failure);
      }
      return yield* Effect.fail(
        new TaskMutationProgressFailure({
          operation: "repo-pull-request-sync",
          changes: { taskIds: [...changedTaskIds], removedTaskIds: [] },
          failure,
        }),
      );
    });
  };

  return {
    repoPullRequestSync(input) {
      return Effect.gen(function* () {
        const result = yield* repoPullRequestSyncDetailed(input).pipe(
          Effect.catchTag("TaskMutationProgressFailure", (partialFailure) =>
            Effect.fail(partialFailure.failure),
          ),
        );
        return { ok: result.ran };
      });
    },
    repoPullRequestSyncDetailed,
  };
};
