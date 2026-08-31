import { pullRequestReviewContextSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitProviderRepository, RepoConfig } from "@openducktor/contracts";
import {
  GITHUB_PROVIDER_ID,
  type GithubCommandDependencies,
} from "../../../application/tasks/support/github-pull-requests";
import { errorMessage, type HostError, HostValidationError } from "../../../effect/host-errors";
import type { GitProviderRepositoryError } from "../../../ports/git-provider-errors";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import {
  createGithubPullRequestReviewReader,
  type GithubPullRequestReviewReader,
} from "./github-pull-request-review-reader";

const unavailable = (reason: string) =>
  pullRequestReviewContextSchema.parse({
    status: "unavailable",
    providerId: GITHUB_PROVIDER_ID,
    reason,
  });

export const createGithubPullRequestReviewAdapter = ({
  githubDependencies,
  getReadRepository,
  reviewReader = createGithubPullRequestReviewReader(),
}: {
  githubDependencies: GithubCommandDependencies;
  getReadRepository: (
    repoConfig: RepoConfig,
  ) => Effect.Effect<GitProviderRepository, HostError | GitProviderRepositoryError>;
  reviewReader?: GithubPullRequestReviewReader;
}): PullRequestReviewProviderPort => {
  return {
    providerId: GITHUB_PROVIDER_ID,
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
        const repositoryResult = yield* Effect.either(getReadRepository(input.repoConfig));
        if (repositoryResult._tag === "Left") {
          return unavailable(errorMessage(repositoryResult.left));
        }

        return yield* reviewReader.read({
          dependencies: githubDependencies,
          repoPath,
          repository: repositoryResult.right,
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
