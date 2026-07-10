import {
  type GitProviderId,
  type PullRequest,
  type PullRequestReviewContext,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";

export type PullRequestReviewContextInput = {
  repoPath: string;
  taskId?: string;
  workingDirectory?: string;
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

const selectProvider = (
  providers: readonly PullRequestReviewProviderPort[],
  repoConfig: Parameters<PullRequestReviewProviderPort["isEnabled"]>[0],
  linkedPullRequest: PullRequest | null,
): PullRequestReviewProviderPort | null => {
  if (linkedPullRequest) {
    return (
      providers.find((provider) => provider.providerId === linkedPullRequest.providerId) ?? null
    );
  }
  return providers.find((provider) => provider.isEnabled(repoConfig)) ?? null;
};

export const createPullRequestReviewService = ({
  providers,
  taskReader,
  workspaceSettingsService,
}: {
  providers: readonly PullRequestReviewProviderPort[];
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

        const provider = selectProvider(providers, repoConfig, linkedPullRequest);
        if (!provider) {
          const providerId = linkedPullRequest?.providerId ?? "unknown";
          return unavailable(
            providerId,
            linkedPullRequest
              ? `Pull request review provider '${providerId}' is not supported.`
              : "No pull request review provider is configured.",
          );
        }

        const reviewResult = yield* Effect.either(
          provider.readContext({
            repoConfig,
            linkedPullRequest,
            ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
          }),
        );
        if (reviewResult._tag === "Left") {
          return providerError(provider.providerId, errorMessage(reviewResult.left));
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
