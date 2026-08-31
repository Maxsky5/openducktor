import {
  type GitProviderId,
  type PullRequest,
  type PullRequestReviewContext,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { GitProviderResolver } from "../git/git-provider-resolver";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";

export type PullRequestReviewContextInput = {
  repoPath: string;
  taskId?: string;
};

export type PullRequestReviewServiceError = HostValidationError | WorkspaceSettingsError;

export type PullRequestReviewService = {
  getContext(
    input: PullRequestReviewContextInput,
  ): Effect.Effect<PullRequestReviewContext, PullRequestReviewServiceError>;
};

export const createPullRequestReviewService = ({
  resolver,
  taskReader,
  workspaceSettingsService,
}: {
  resolver: GitProviderResolver;
  taskReader: Pick<TaskReader, "getTask">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}): PullRequestReviewService => ({
  getContext(input) {
    return Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
      let pullRequest: PullRequest | null = null;
      if (input.taskId) {
        const taskResult = yield* Effect.either(
          taskReader.getTask({ repoPath: repoConfig.repoPath, taskId: input.taskId }),
        );
        if (taskResult._tag === "Left") {
          return providerError("unknown", errorMessage(taskResult.left));
        }
        pullRequest = taskResult.right.pullRequest ?? null;
      }

      if (!pullRequest) {
        return noPullRequest(input.taskId);
      }

      const providerId = pullRequest.providerId;
      const providerResult = yield* Effect.either(resolver.resolve(repoConfig));
      if (providerResult._tag === "Left") {
        return unavailable(providerId, errorMessage(providerResult.left));
      }

      const provider = providerResult.right;
      const descriptor = provider.getDescriptor();
      if (descriptor.id !== providerId) {
        return unavailable(
          providerId,
          `Pull request review provider '${providerId}' is not supported.`,
        );
      }

      if (!descriptor.capabilities.supportsPullRequestReview) {
        return unavailable(
          providerId,
          `Git provider '${providerId}' does not support Pull Request review.`,
        );
      }

      const reviewPortResult = yield* Effect.either(provider.pullRequestReview());
      if (reviewPortResult._tag === "Left") {
        return unavailable(providerId, errorMessage(reviewPortResult.left));
      }
      const reviewPort = reviewPortResult.right;
      const contextResult = yield* Effect.either(
        reviewPort.readContext({
          repoConfig,
          linkedPullRequest: pullRequest,
        }),
      );
      if (contextResult._tag === "Left") {
        return providerError(providerId, errorMessage(contextResult.left));
      }
      return contextResult.right;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({
              message: errorMessage(cause),
              cause,
            }),
      ),
    );
  },
});

const unavailable = (providerId: GitProviderId, reason: string): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "unavailable",
    providerId,
    reason,
  });

const providerError = (providerId: GitProviderId, reason: string): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "error",
    providerId,
    reason,
  });

const noPullRequest = (taskId: string | undefined): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "no_pull_request",
    providerId: "unknown",
    reason: taskId ? `Task ${taskId} has no linked pull request.` : "No linked pull request.",
  });
