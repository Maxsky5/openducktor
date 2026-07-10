import { pullRequestReviewContextSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createGithubPullRequestReviewProvider,
  type GithubPullRequestReviewProvider,
} from "../../application/pull-requests/github-pull-request-review-provider";
import {
  GITHUB_PROVIDER_ID,
  type GithubCommandDependencies,
  type GithubRepositoryDependencies,
  githubProviderStatus,
  requireGithubPullRequestContext,
} from "../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";

const unavailable = (reason: string) =>
  pullRequestReviewContextSchema.parse({
    status: "unavailable",
    providerId: GITHUB_PROVIDER_ID,
    reason,
  });

export const createGithubPullRequestReviewAdapter = ({
  gitPort,
  githubDependencies,
  reviewProvider = createGithubPullRequestReviewProvider(),
}: {
  gitPort: GitPort;
  githubDependencies: GithubCommandDependencies;
  reviewProvider?: GithubPullRequestReviewProvider;
}): PullRequestReviewProviderPort => {
  const repositoryDependencies: GithubRepositoryDependencies = {
    ...githubDependencies,
    gitPort,
  };

  return {
    providerId: GITHUB_PROVIDER_ID,
    isEnabled: (repoConfig) => repoConfig.git.providers[GITHUB_PROVIDER_ID]?.enabled === true,
    readContext(input) {
      return Effect.gen(function* () {
        if (input.linkedPullRequest.providerId !== GITHUB_PROVIDER_ID) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "pullRequest.providerId",
              message: `GitHub review adapter cannot load provider '${input.linkedPullRequest.providerId}'.`,
            }),
          );
        }

        const repoPath = input.repoConfig.repoPath;
        const status = yield* githubProviderStatus(
          repositoryDependencies,
          repoPath,
          input.repoConfig,
        );
        if (!status.available) {
          return unavailable(status.reason ?? "GitHub provider is unavailable.");
        }

        const contextResult = yield* Effect.either(
          requireGithubPullRequestContext(repositoryDependencies, repoPath, input.repoConfig),
        );
        if (contextResult._tag === "Left") {
          return unavailable(errorMessage(contextResult.left));
        }
        const context = contextResult.right;

        return yield* reviewProvider.read({
          dependencies: githubDependencies,
          repoPath,
          context,
          pullRequestNumber: input.linkedPullRequest.number,
        });
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
