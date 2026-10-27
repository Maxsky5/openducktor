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
import { ensureNoDirectMergeEffect } from "../support/direct-merge-block";
import {
  requireEffectEvent,
  requirePullRequestManagement,
  taskEventPolicyError,
} from "../support/task-workflow-events";
import { enrichTask } from "../support/task-workflow-helpers";
import { cleanupConfirmedMergeClose } from "../support/task-close-cleanup";
import {
  canSkipRelinkedPullRequestCleanup,
  loadTaskBranchCleanup,
} from "../support/task-worktree-cleanup";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskLinkMergedPullRequestUseCase = ({
  taskWorkflows,
  gitPort,
  gitProviderResolver,
  taskStore,
  settingsConfig,
  taskActivityGuard,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "linkMergedPullRequest"> => ({
  linkMergedPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, pullRequest, removeWorktree } = input;

      const current = yield* taskStore.getTask({ repoPath, taskId });
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
      const workflow = taskWorkflows.forTask(current);
      const closeEvent = yield* requireEffectEvent(workflow, "pull_request.merged");
      const closure = workflow.decide(closeEvent, current);
      if (closure.kind === "unchanged" && sameExistingPullRequest) {
        return enrichTask(workflow, current);
      }

      const dependencies = yield* requireDependencies(() =>
        requireLinkMergedPullRequestDependencies({
          gitPort,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          worktreeFiles,
          workspaceSettingsService,
        }),
      );
      yield* requirePullRequestManagement(workflow, current);
      yield* ensureNoDirectMergeEffect({
        operation: "link_merged_pull_request",
        repoPath,
        taskId,
        directMerge: metadata.directMerge,
      });
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

      const loadCleanup = loadTaskBranchCleanup(
        dependencies,
        workflow,
        current,
        repoPath,
        taskId,
        "Pull request linking",
      );
      // The cleanup needs the task branch. A relink can find it already removed.
      let hasTaskBranch = false;
      if (metadata.pullRequest === undefined) {
        yield* loadCleanup;
        hasTaskBranch = true;
      } else {
        const cleanupResult = yield* Effect.result(loadCleanup);
        if (cleanupResult._tag === "Success") {
          hasTaskBranch = true;
        } else {
          const message = errorMessage(cleanupResult.failure);
          if (!canSkipRelinkedPullRequestCleanup(message)) {
            return yield* Effect.fail(cleanupResult.failure);
          }
        }
      }

      if (hasTaskBranch) {
        yield* requireWorktreeFiles(dependencies.worktreeFiles);
      }
      yield* taskStore.setPullRequest({ repoPath, taskId, pullRequest });
      const postLink = yield* Effect.result(
        Effect.gen(function* () {
          if (closure.kind === "denied") {
            return yield* taskEventPolicyError(closeEvent, current, closure);
          }
          const cleanupEffect = hasTaskBranch
            ? cleanupConfirmedMergeClose({
                dependencies: { ...dependencies, taskActivityGuard },
                taskStore,
                lifecycle: taskSessionLifecycleCoordinator,
                repoPath,
                workflow,
                task: current,
                // The confirmation showed the uncommitted files that removal deletes.
                worktreeCleanup: { remove: removeWorktree, force: true },
              })
            : runTaskRuntimeCleanup({
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
            decision: closure,
            taskId,
            taskSessionLifecycleCoordinator,
            taskStore,
          });
        }),
      );
      if (postLink._tag === "Failure") {
        return yield* Effect.fail(
          createTaskMutationProgressFailure("link-merged-pull-request", taskId, postLink.failure),
        );
      }
      const task = postLink.success;

      return enrichTask(workflow, task);
    });
  },
});
