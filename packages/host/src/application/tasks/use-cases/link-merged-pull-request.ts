import {
  planBackgroundSteps,
  backgroundStep,
  CurrentBackgroundOperation,
  updateBackgroundOperation,
} from "../../operation-progress/background-operation-progress";
import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { getScopedRepoConfig } from "../../workspaces/scoped-repo-config";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { requireWorktreeFiles } from "../../git/git-service-inputs";
import { requirePullRequestProviderMatch } from "../../pull-requests/pull-request-provider-match";
import {
  requireDependencies,
  requireLinkMergedPullRequestDependencies,
  requirePullRequestLinkDependencies,
} from "../support/required-task-dependencies";
import { completeTaskClosure } from "../support/task-closure";
import { ensureNoDirectMergeEffect } from "../support/direct-merge-block";
import { coreTaskTransition, requirePullRequestManagement } from "../support/task-workflow-events";
import { enrichTask } from "../support/task-workflow-helpers";
import { cleanupConfirmedMergeClose } from "../support/task-close-cleanup";
import { inspectTaskBranches } from "../support/task-branches";
import { createTaskMutationProgressFailure } from "../task-mutation-progress-failure";
import type { TaskServiceUseCaseInput, TaskServiceWithMutationProgress } from "../task-service";

export const createTaskLinkMergedPullRequestUseCase = ({
  taskWorkflows,
  gitPort,
  gitProviderResolver,
  taskStore,
  settingsConfig,
  systemCommands,
  taskActivityGuard,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
  workspaceSettingsService,
  worktreeOwners,
}: TaskServiceUseCaseInput): Pick<TaskServiceWithMutationProgress, "linkMergedPullRequest"> => ({
  linkMergedPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, pullRequest, removeWorktree } = input;
      yield* planBackgroundSteps(
        { id: "pr-link", label: "Link merged pull request" },
        { id: "terminals", label: "Stop task terminals" },
        { id: "task-close", label: "Close task" },
      );
      const current = yield* taskStore.getTask(input);
      const metadata = yield* taskStore.getTaskMetadata(input);
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
      const repoConfig = yield* getScopedRepoConfig(
        providerDependencies.workspaceSettingsService,
        input,
      );
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
      if (current.status === TASK_CLOSED_STATE && sameExistingPullRequest) {
        return enrichTask(workflow, current);
      }

      const dependencies = yield* requireDependencies(() =>
        requireLinkMergedPullRequestDependencies({
          gitPort,
          settingsConfig,
          systemCommands,
          taskWorktreeService,
          terminalService,
          worktreeFiles,
          workspaceSettingsService,
        }),
      );
      yield* requirePullRequestManagement(current);
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

      if (sameExistingPullRequest) {
        yield* updateBackgroundOperation((progress) =>
          progress.update({
            id: "pr-link",
            label: "Link merged pull request",
            state: "completed",
            details: [`Pull request #${pullRequest.number} was already linked.`],
          }),
        );
      }
      let removeCheckedWorktree = false;
      if (!sameExistingPullRequest || removeWorktree) {
        const branchState = yield* inspectTaskBranches(dependencies, {
          workspaceId: input.workspaceId,
          repoPath,
          task: current,
          operationLabel: "Pull request linking",
        });
        if (
          branchState.kind === "unavailable" &&
          (!sameExistingPullRequest || (yield* CurrentBackgroundOperation))
        )
          return yield* backgroundStep(
            { id: "check-branch", label: "Check task branch" },
            Effect.fail(branchState.error),
          );
        removeCheckedWorktree = removeWorktree && branchState.kind === "available";
      }
      if (removeCheckedWorktree) {
        yield* requireWorktreeFiles(dependencies.worktreeFiles);
      }
      yield* backgroundStep(
        { id: "pr-link", label: "Link merged pull request" },
        taskStore.setPullRequest({
          workspaceId: input.workspaceId,
          repoPath,
          taskId,
          pullRequest,
        }),
      );
      const postLink = yield* Effect.result(
        completeTaskClosure({
          workspaceId: input.workspaceId,
          cleanup: cleanupConfirmedMergeClose({
            workspaceId: input.workspaceId,
            dependencies: { ...dependencies, taskActivityGuard, worktreeOwners },
            taskStore,
            lifecycle: taskSessionLifecycleCoordinator,
            repoPath,
            task: current,
            worktreeCleanup: {
              remove: removeCheckedWorktree,
              // The confirmation showed the uncommitted files that removal deletes.
              force: true,
            },
          }),
          gitPort: dependencies.gitPort,
          operation: "link merged pull request",
          repoPath,
          decide: coreTaskTransition(taskWorkflows, "close"),
          taskId,
          taskActivityGuard,
          taskSessionLifecycleCoordinator,
          taskStore,
        }),
      );
      if (postLink._tag === "Failure") {
        return yield* Effect.fail(
          createTaskMutationProgressFailure("link-merged-pull-request", taskId, postLink.failure),
        );
      }
      if (sameExistingPullRequest)
        yield* updateBackgroundOperation((progress) => progress.omit("pr-link"));
      return enrichTask(workflow, postLink.success);
    });
  },
});
