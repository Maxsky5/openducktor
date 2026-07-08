import {
  type PullRequestReviewContext,
  pullRequestReviewContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import {
  findGithubPullRequestForBranch,
  GITHUB_PROVIDER_ID,
  type GithubCommandDependencies,
  type GithubRepositoryDependencies,
  githubProviderStatus,
  requireGithubPullRequestContext,
} from "../tasks/support/github-pull-requests";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import type { GithubPullRequestReviewProvider } from "./github-pull-request-review-provider";

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

const unavailable = (reason: string): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "unavailable",
    providerId: "github",
    reason,
  });

const noPullRequest = (reason: string): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "no_pull_request",
    providerId: "github",
    reason,
  });

const providerError = (reason: string): PullRequestReviewContext =>
  pullRequestReviewContextSchema.parse({
    status: "error",
    providerId: "github",
    reason,
  });

export const createPullRequestReviewService = ({
  gitPort,
  githubDependencies,
  githubReviewProvider,
  taskReader,
  workspaceSettingsService,
}: {
  gitPort: GitPort;
  githubDependencies: GithubCommandDependencies;
  githubReviewProvider: GithubPullRequestReviewProvider;
  taskReader: TaskReader;
  workspaceSettingsService: WorkspaceSettingsService;
}): PullRequestReviewService => {
  const githubRepositoryDependencies: GithubRepositoryDependencies = {
    ...githubDependencies,
    gitPort,
  };

  return {
    getContext(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* workspaceSettingsService.getRepoConfigByRepoPath(input.repoPath);
        const providerConfig = repoConfig.git.providers[GITHUB_PROVIDER_ID];
        if (!providerConfig?.enabled) {
          return unavailable("GitHub provider is not enabled for this repository.");
        }

        const status = yield* githubProviderStatus(
          githubRepositoryDependencies,
          repoConfig.repoPath,
          repoConfig,
        );
        if (!status.available) {
          return unavailable(status.reason ?? "GitHub provider is unavailable.");
        }

        const contextResult = yield* Effect.either(
          requireGithubPullRequestContext(
            githubRepositoryDependencies,
            repoConfig.repoPath,
            repoConfig,
          ),
        );
        if (contextResult._tag === "Left") {
          return unavailable(errorMessage(contextResult.left));
        }
        const context = contextResult.right;

        let pullRequestNumber: number | null = null;
        if (input.taskId) {
          const taskResult = yield* Effect.either(
            taskReader.getTask({ repoPath: repoConfig.repoPath, taskId: input.taskId }),
          );
          if (taskResult._tag === "Left") {
            return providerError(errorMessage(taskResult.left));
          }
          const taskPullRequest = taskResult.right.pullRequest;
          if (taskPullRequest?.providerId === GITHUB_PROVIDER_ID) {
            pullRequestNumber = taskPullRequest.number;
          }
        }

        if (pullRequestNumber === null) {
          const workingDirectory = input.workingDirectory ?? repoConfig.repoPath;
          const currentBranchResult = yield* Effect.either(
            gitPort.getCurrentBranch(workingDirectory),
          );
          if (currentBranchResult._tag === "Left") {
            return providerError(errorMessage(currentBranchResult.left));
          }
          const sourceBranch = currentBranchResult.right.name;
          if (!sourceBranch) {
            return noPullRequest("Current Git branch is detached or unavailable.");
          }
          const pullRequestResult = yield* Effect.either(
            findGithubPullRequestForBranch(
              githubDependencies,
              repoConfig.repoPath,
              context,
              sourceBranch,
              "open",
            ),
          );
          if (pullRequestResult._tag === "Left") {
            return providerError(errorMessage(pullRequestResult.left));
          }
          if (!pullRequestResult.right) {
            return noPullRequest(`No open GitHub pull request found for ${sourceBranch}.`);
          }
          pullRequestNumber = pullRequestResult.right.record.number;
        }

        const reviewResult = yield* Effect.either(
          githubReviewProvider.read({
            dependencies: githubDependencies,
            repoPath: repoConfig.repoPath,
            context,
            pullRequestNumber,
          }),
        );
        if (reviewResult._tag === "Left") {
          return providerError(errorMessage(reviewResult.left));
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
