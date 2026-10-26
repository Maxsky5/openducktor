import { Effect } from "effect";
import { ensureCleanTaskWorktree } from "../../../domain/task";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import { requirePullRequestProviderMatch } from "../../pull-requests/pull-request-provider-match";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import {
  pullRequestLinkFailure,
  pullRequestWriteFailure,
} from "../support/pull-request-publication-errors";
import {
  requireDependencies,
  requirePullRequestLinkDependencies,
  requirePullRequestUpsertDependencies,
} from "../support/required-task-dependencies";
import { ensureNoDirectMergeEffect } from "../support/direct-merge-block";
import { requirePullRequestManagement } from "../support/task-workflow-events";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

type Cases = Pick<TaskService, "linkPullRequest" | "upsertPullRequest" | "unlinkPullRequest">;

export const createTaskPullRequestManagementUseCases = ({
  taskWorkflows,
  gitPort,
  gitProviderResolver,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Cases => ({
  linkPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, number } = input;
      const dependencies = yield* requireDependencies(() =>
        requirePullRequestLinkDependencies({
          gitProviderResolver,
          workspaceSettingsService,
        }),
      );
      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* requirePullRequestManagement(taskWorkflows.forRepo(repoPath), current);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      if (metadata.pullRequest !== undefined) {
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} already has a linked pull request.`,
          details: { repoPath, taskId },
        });
      }
      yield* ensureNoDirectMergeEffect({
        operation: "link_pull_request",
        repoPath,
        taskId,
        directMerge: metadata.directMerge,
      });
      const repoConfig =
        yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
      const effectiveRepoPath = repoConfig.repoPath;
      const provider = yield* dependencies.gitProviderResolver.resolve(repoConfig);
      const selectedProviderId = provider.getDescriptor().id;
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
      yield* ensureNoDirectMergeEffect({
        operation: "upsert_pull_request",
        repoPath: effectiveRepoPath,
        taskId,
        directMerge: metadata.directMerge,
      });
      const approval = yield* loadOpenApprovalContext(
        dependencies,
        taskWorkflows.forRepo(repoPath),
        taskId,
        current,
        metadata,
        repoConfig,
      );
      yield* Effect.try({
        try: () => ensureCleanTaskWorktree(approval),
        catch: (cause) =>
          new HostValidationError({
            message: errorMessage(cause),
            cause,
          }),
      });
      const provider = yield* dependencies.gitProviderResolver.resolve(repoConfig);
      const pullRequests = yield* provider.pullRequests();
      const isAzureDevOps = provider.getDescriptor().id === "azure_devops";
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
        return yield* new HostValidationError({
          field: "taskId",
          message: `Failed to push the task branch before creating the pull request: ${pushResult.output}`,
          details: { repoPath: effectiveRepoPath, taskId },
        });
      }
      const pushDetails = {
        repoPath: effectiveRepoPath,
        taskId,
        remote,
        branch: approval.sourceBranch,
      };
      const writeFailure = pullRequestWriteFailure(pushDetails);
      const pullRequest = yield* pullRequests
        .upsert({
          repoConfig,
          approval,
          title: content.title,
          body: content.body,
        })
        .pipe(Effect.mapError((cause) => (isAzureDevOps ? writeFailure(cause) : cause)));
      const linkFailure = pullRequestLinkFailure(pushDetails, pullRequest);
      yield* requirePullRequestProviderMatch({
        configuredProviderId: provider.getDescriptor().id,
        linkedProviderId: pullRequest.providerId,
      }).pipe(Effect.mapError((cause) => (isAzureDevOps ? linkFailure(cause) : cause)));
      yield* taskStore
        .setPullRequest({ repoPath: effectiveRepoPath, taskId, pullRequest })
        .pipe(Effect.mapError((cause) => (isAzureDevOps ? linkFailure(cause) : cause)));
      return pullRequest;
    });
  },
  unlinkPullRequest(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const current = yield* taskStore.getTask({ repoPath, taskId });
      yield* requirePullRequestManagement(taskWorkflows.forRepo(repoPath), current);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      if (metadata.pullRequest === undefined) {
        return yield* new HostValidationError({
          field: "taskId",
          message: `Task ${taskId} does not have a linked pull request.`,
          details: { repoPath, taskId },
        });
      }
      return yield* taskStore.setPullRequest({ repoPath, taskId, pullRequest: null });
    });
  },
});
