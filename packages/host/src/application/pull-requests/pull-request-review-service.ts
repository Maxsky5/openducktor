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

export const createPullRequestReviewService = ({
  resolver,
  taskReader,
  workspaceSettingsService,
}: {
  resolver: GitProviderResolver;
  taskReader: Pick<TaskReader, "getTask">;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
}): PullRequestReviewService => {
  return {
    getContext(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
        let linkedPullRequest: PullRequest | null = null;
        if (input.taskId) {
          const taskResult = yield* Effect.either(
            taskReader.getTask({ repoPath: repoConfig.repoPath, taskId: input.taskId }),
          );
          if (taskResult._tag === "Left") {
            return providerError("unknown", errorMessage(taskResult.left));
          }
          linkedPullRequest = taskResult.right.pullRequest ?? null;
        }

        if (!linkedPullRequest) {
          return noPullRequest(input.taskId);
        }

        const providerId = linkedPullRequest.providerId;
        const resolvedProvider = yield* Effect.either(resolver.resolve(repoConfig));
        if (resolvedProvider._tag === "Left") {
          const reason =
            resolvedProvider.left.reason === "not_registered"
              ? `Pull request review provider '${providerId}' is not supported.`
              : errorMessage(resolvedProvider.left);
          return unavailable(providerId, reason);
        }

        const provider = resolvedProvider.right;
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

        const reviewProviderResult = yield* Effect.either(provider.pullRequestReview());
        if (reviewProviderResult._tag === "Left") {
          return unavailable(providerId, errorMessage(reviewProviderResult.left));
        }
        const reviewProvider = reviewProviderResult.right;
        const reviewResult = yield* Effect.either(
          reviewProvider.readContext({
            repoConfig,
            linkedPullRequest,
          }),
        );
        if (reviewResult._tag === "Left") {
          return providerError(providerId, errorMessage(reviewResult.left));
        }
        return reviewResult.right;
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
  };
};
