import type { PullRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  requireDependencies,
  requireMergedTaskCleanupDependencies,
  requirePullRequestSyncDependencies,
} from "../support/required-task-dependencies";
import { completeTaskClosure } from "../support/task-closure";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { taskListWithCurrent } from "../support/task-workflow-helpers";
import { cleanupMergedTaskState } from "../support/task-worktree-cleanup";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { CreateTaskServiceInput, TaskService, TaskServiceError } from "../task-service";

export const createTaskPullRequestSyncUseCases = ({
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
}: CreateTaskServiceInput): Pick<
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
            gitProviderResolver,
            workspaceSettingsService,
          }),
        );
        const repoConfig =
          yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
        const effectiveRepoPath = repoConfig.repoPath;
        const providerResult = yield* Effect.either(
          dependencies.gitProviderResolver.resolve(repoConfig),
        );
        if (providerResult._tag === "Left") {
          if (
            providerResult.left.reason === "not_configured" ||
            providerResult.left.reason === "disabled"
          ) {
            return { ran: false, changedTaskIds: [] };
          }
          return yield* Effect.fail(providerResult.left);
        }
        const provider = providerResult.right;
        const pullRequests = yield* provider.pullRequests();
        const providerId = provider.getDescriptor().id;

        const tasks = yield* taskStore.listPullRequestSyncCandidates({
          repoPath: effectiveRepoPath,
        });
        for (const task of tasks) {
          const pullRequest = task.pullRequest;
          if (!pullRequest) {
            continue;
          }

          if (pullRequest.providerId !== providerId) {
            continue;
          }
          const updated = yield* pullRequests.getByNumber({
            repoConfig,
            number: pullRequest.number,
          });

          if (updated.record.state === "merged" && task.status !== "closed") {
            const cleanupDependencies = yield* requireDependencies(() =>
              requireMergedTaskCleanupDependencies(
                {
                  devServerService,
                  gitPort,
                  settingsConfig,
                  taskWorktreeService,
                  terminalService,
                  worktreeFiles,
                },
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
              cleanup: cleanupMergedTaskState(
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

const pullRequestRecordsMatch = (left: PullRequest, right: PullRequest): boolean => {
  const { lastSyncedAt: _leftSync, ...leftRecord } = left;
  const { lastSyncedAt: _rightSync, ...rightRecord } = right;
  return JSON.stringify(leftRecord) === JSON.stringify(rightRecord);
};
