import { Effect } from "effect";
import { ensureCleanTaskWorktree } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { requirePullRequestProviderMatch } from "../../pull-requests/pull-request-provider-match";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import {
  requireDependencies,
  requirePullRequestLinkDependencies,
  requirePullRequestUpsertDependencies,
} from "../support/required-task-dependencies";
import { validatePullRequestManagementStatusEffect } from "../support/task-validation-effects";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

type Cases = Pick<TaskService, "linkPullRequest" | "upsertPullRequest" | "unlinkPullRequest">;

export const createTaskPullRequestManagementUseCases = ({
  gitPort,
  gitProviderResolver,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Cases => ({
  linkPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, providerId, number } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestLinkDependencies({
          gitProviderResolver,
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
            message: `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const provider = yield* dependencies.gitProviderResolver.resolve(repoConfig);
      const selectedProviderId = provider.getDescriptor().id;
      yield* requirePullRequestProviderMatch({
        configuredProviderId: selectedProviderId,
        linkedProviderId: providerId,
        field: "providerId",
      });
      const pullRequests = yield* provider.pullRequests();
      const pullRequest = yield* pullRequests.getByNumber({ repoConfig, number });
      yield* requirePullRequestProviderMatch({
        configuredProviderId: selectedProviderId,
        linkedProviderId: pullRequest.record.providerId,
      });
      yield* taskStore.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: pullRequest.record,
      });
      return pullRequest.record;
    });
  },
  upsertPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, content } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestUpsertDependencies({
          gitPort,
          gitProviderResolver,
          settingsConfig,
          taskWorktreeService,
          workspaceSettingsService,
        }),
      );
      const current = yield* taskStore.getTask({ repoPath, taskId });
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const metadata = yield* taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
      if (metadata.directMerge !== undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `A local direct merge is already recorded for task ${taskId}. Finish or discard that direct merge workflow before opening a pull request.`,
            details: { repoPath: effectiveRepoPath, taskId },
          }),
        );
      }
      const approval = yield* loadOpenApprovalContext(
        dependencies,
        taskId,
        current,
        metadata,
        repoConfig,
      );
      yield* Effect.try({
        try: () => ensureCleanTaskWorktree(approval),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      if (!approval.workingDirectory) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Human approval requires a task worktree for task ${taskId}. Start Builder first.`,
            details: { repoPath: effectiveRepoPath, taskId },
          }),
        );
      }
      const provider = yield* dependencies.gitProviderResolver.resolve(repoConfig);
      const pullRequests = yield* provider.pullRequests();
      if (approval.pullRequest !== undefined) {
        yield* requirePullRequestProviderMatch({
          configuredProviderId: provider.getDescriptor().id,
          linkedProviderId: approval.pullRequest.providerId,
        });
      }
      const remote = yield* pullRequests.resolvePublishRemote({ repoConfig });
      const pushResult = yield* dependencies.gitPort.pushBranch(
        approval.workingDirectory,
        approval.sourceBranch,
        {
          remote,
          setUpstream: true,
          forceWithLease: false,
        },
      );
      if (pushResult.outcome === "rejected_non_fast_forward") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Failed to push the task branch before creating the pull request: ${pushResult.output}`,
            details: { repoPath: effectiveRepoPath, taskId },
          }),
        );
      }
      const pullRequest = yield* pullRequests.upsert({
        repoConfig,
        approval,
        title: content.title,
        body: content.body,
      });
      yield* requirePullRequestProviderMatch({
        configuredProviderId: provider.getDescriptor().id,
        linkedProviderId: pullRequest.providerId,
      });
      yield* taskStore.setPullRequest({ repoPath: effectiveRepoPath, taskId, pullRequest });
      return pullRequest;
    });
  },
  unlinkPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* validatePullRequestManagementStatusEffect(current.status);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      if (metadata.pullRequest === undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task ${taskId} does not have a linked pull request.`,
            details: { repoPath, taskId },
          }),
        );
      }

      return yield* taskStore.setPullRequest({ repoPath, taskId, pullRequest: null });
    });
  },
});
