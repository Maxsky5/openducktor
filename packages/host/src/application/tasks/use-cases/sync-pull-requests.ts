import { pullRequestRecordsMatch } from "../support/pull-request-records-match";
import { getScopedRepoConfig } from "../support/scoped-repo-config";
import { Effect } from "effect";
import { requirePullRequestProviderMatch } from "../../pull-requests/pull-request-provider-match";
import {
  requireDependencies,
  requireMergedTaskCleanupDependencies,
  requirePullRequestSyncDependencies,
} from "../support/required-task-dependencies";
import {
  closeSyncedMergedTask,
  syncedMergedTaskFailure,
} from "../support/close-synced-merged-task";
import { TaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type {
  AutoCloseFailure,
  RepoPullRequestSyncResult,
  TaskService,
  TaskServiceError,
  TaskServiceUseCaseInput,
} from "../task-service";

export const createTaskPullRequestSyncUseCases = ({
  gitPort,
  gitProviderResolver,
  taskStore,
  taskWorkflows,
  settingsConfig,
  taskActivityGuard,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  worktreeOwners,
}: TaskServiceUseCaseInput): Pick<
  TaskService,
  "repoPullRequestSync" | "repoPullRequestSyncDetailed"
> => {
  const repoPullRequestSyncDetailed: TaskService["repoPullRequestSyncDetailed"] = (input) => {
    const changedTaskIds = new Set<string>();
    const sync: Effect.Effect<RepoPullRequestSyncResult, TaskServiceError> = Effect.gen(
      function* () {
        const dependencies = yield* requireDependencies(() =>
          requirePullRequestSyncDependencies({
            gitProviderResolver,
            workspaceSettingsService,
          }),
        );
        const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
        const effectiveRepoPath = repoConfig.repoPath;
        const providerResult = yield* Effect.result(
          dependencies.gitProviderResolver.resolve(repoConfig),
        );
        if (providerResult._tag === "Failure") {
          if (
            providerResult.failure.reason === "not_configured" ||
            providerResult.failure.reason === "disabled"
          ) {
            return {
              ran: false,
              changedTaskIds: [],
              reason: providerResult.failure.reason,
              message: `${providerResult.failure.message} Open Git provider settings to configure or enable the provider.`,
            };
          }
          return yield* Effect.fail(providerResult.failure);
        }
        const provider = providerResult.success;
        const pullRequests = yield* provider.pullRequests();
        const providerId = provider.getDescriptor().id;

        const tasks = yield* taskStore.listPullRequestSyncCandidates({
          workspaceId: input.workspaceId,
          repoPath: effectiveRepoPath,
        });
        const closureFailures: AutoCloseFailure[] = [];
        for (const task of tasks) {
          const pullRequest = task.pullRequest;
          if (!pullRequest) {
            continue;
          }

          yield* requirePullRequestProviderMatch({
            configuredProviderId: providerId,
            linkedProviderId: pullRequest.providerId,
          });
          const updated = yield* pullRequests.refresh({
            repoConfig,
            linkedPullRequest: pullRequest,
          });
          yield* requirePullRequestProviderMatch({
            configuredProviderId: providerId,
            linkedProviderId: updated.record.providerId,
          });

          // Sync candidates exclude closed tasks.
          if (updated.record.state === "merged") {
            const cleanupDependencies = yield* requireDependencies(() =>
              requireMergedTaskCleanupDependencies(
                {
                  gitPort,
                  settingsConfig,
                  taskWorktreeService,
                  terminalService,
                  workspaceSettingsService,
                  worktreeFiles,
                },
                "repo_pull_request_sync",
              ),
            );
            yield* taskStore.setPullRequest({
              workspaceId: input.workspaceId,
              repoPath: effectiveRepoPath,
              taskId: task.id,
              pullRequest: updated.record,
            });
            changedTaskIds.add(task.id);
            // A task that cannot close does not stop the sync of the other tasks.
            const closure = yield* Effect.result(
              closeSyncedMergedTask(
                {
                  ...cleanupDependencies,
                  taskStore,
                  taskWorkflows,
                  taskActivityGuard,
                  taskSessionLifecycleCoordinator,
                  worktreeOwners,
                },
                {
                  workspaceId: input.workspaceId,
                  repoPath: effectiveRepoPath,
                  taskId: task.id,
                  sourceBranch: updated.sourceBranch,
                  targetBranch: updated.targetBranch,
                },
              ),
            );
            if (closure._tag === "Failure")
              closureFailures.push({ taskId: task.id, failure: closure.failure });
          } else if (!pullRequestRecordsMatch(updated.record, pullRequest)) {
            yield* taskStore.setPullRequest({
              workspaceId: input.workspaceId,
              repoPath: effectiveRepoPath,
              taskId: task.id,
              pullRequest: updated.record,
            });
            changedTaskIds.add(task.id);
          }
        }

        return {
          ran: true,
          changedTaskIds: [...changedTaskIds],
          autoCloseFailures: closureFailures,
        };
      },
    );
    return Effect.gen(function* () {
      const result = yield* Effect.result(sync);
      if (result._tag === "Success") {
        return result.success;
      }
      const failure = result.failure;
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
        if (!result.ran) return { ok: false, reason: result.reason, message: result.message };
        const failure = syncedMergedTaskFailure(result.autoCloseFailures);
        if (failure) return yield* Effect.fail(failure);
        return { ok: true };
      });
    },
    repoPullRequestSyncDetailed,
  };
};
