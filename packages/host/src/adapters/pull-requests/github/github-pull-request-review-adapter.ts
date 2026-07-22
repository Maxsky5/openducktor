import { pullRequestReviewContextSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  GITHUB_PROVIDER_ID,
  type GithubCommandDependencies,
  requireGithubPullRequestReadRepository,
} from "../../../application/tasks/support/github-pull-requests";
import { errorMessage, HostValidationError } from "../../../effect/host-errors";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import {
  createGithubPullRequestReviewProvider,
  type GithubPullRequestReviewProvider,
} from "./github-pull-request-review-provider";

const unavailable = (reason: string) =>
  pullRequestReviewContextSchema.parse({
    status: "unavailable",
    providerId: GITHUB_PROVIDER_ID,
    reason,
  });

export const createGithubPullRequestReviewAdapter = ({
  githubDependencies,
  reviewProvider = createGithubPullRequestReviewProvider(),
}: {
  githubDependencies: GithubCommandDependencies;
  reviewProvider?: GithubPullRequestReviewProvider;
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
        const repositoryResult = yield* Effect.either(
          requireGithubPullRequestReadRepository(githubDependencies, repoPath, input.repoConfig),
        );
        if (repositoryResult._tag === "Left") {
          return unavailable(errorMessage(repositoryResult.left));
        }

        return yield* reviewProvider.read({
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
