import { GITHUB_PROVIDER_DESCRIPTOR, type GitProviderDescriptor } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  findGithubPullRequestForBranch,
  fetchGithubPullRequestByNumber,
  type GithubCommandDependencies,
  githubProviderStatus,
  requireGithubPullRequestContext,
  requireGithubPullRequestReadRepository,
  upsertGithubPullRequest,
} from "../../application/tasks/support/github-pull-requests";
import type { GitPort } from "../../ports/git-port";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import { createGithubPullRequestReviewAdapter } from "../pull-requests/github/github-pull-request-review-adapter";

export class GithubProviderAdapter implements GitProviderPort {
  private readonly repositoryPort: GitProviderRepositoryPort;
  private readonly healthPort: GitProviderHealthPort;
  private readonly pullRequestsPort: PullRequestProviderPort;
  private readonly pullRequestReviewPort: PullRequestReviewProviderPort;

  constructor({
    githubDependencies,
    gitPort,
  }: {
    githubDependencies: GithubCommandDependencies;
    gitPort: GitPort;
  }) {
    const repositoryDependencies = { ...githubDependencies, gitPort };
    this.repositoryPort = {
      getReadRepository: (repoConfig) =>
        requireGithubPullRequestReadRepository(githubDependencies, repoConfig.repoPath, repoConfig),
      getWriteContext: (repoConfig) =>
        requireGithubPullRequestContext(repositoryDependencies, repoConfig.repoPath, repoConfig),
    };
    this.healthPort = {
      getStatus: (repoConfig) =>
        githubProviderStatus(repositoryDependencies, repoConfig.repoPath, repoConfig),
    };
    this.pullRequestsPort = {
      findByBranch: (input) =>
        Effect.gen(function* () {
          const context = yield* requireGithubPullRequestContext(
            repositoryDependencies,
            input.repoConfig.repoPath,
            input.repoConfig,
          );
          const pullRequest = yield* findGithubPullRequestForBranch(
            githubDependencies,
            input.repoConfig.repoPath,
            context,
            input.sourceBranch,
            input.state,
          );
          return pullRequest?.record;
        }),
      getByNumber: (input) =>
        Effect.gen(function* () {
          const context = yield* requireGithubPullRequestContext(
            repositoryDependencies,
            input.repoConfig.repoPath,
            input.repoConfig,
          );
          const pullRequest = yield* fetchGithubPullRequestByNumber(
            githubDependencies,
            input.repoConfig.repoPath,
            context,
            input.number,
          );
          return pullRequest.record;
        }),
      upsert: (input) =>
        Effect.gen(function* () {
          const context = yield* requireGithubPullRequestContext(
            repositoryDependencies,
            input.repoConfig.repoPath,
            input.repoConfig,
          );
          return yield* upsertGithubPullRequest(
            githubDependencies,
            input.repoConfig.repoPath,
            context,
            input.approval,
            input.title,
            input.body,
          );
        }),
    };
    this.pullRequestReviewPort = createGithubPullRequestReviewAdapter({ githubDependencies });
  }

  getDescriptor(): GitProviderDescriptor {
    return GITHUB_PROVIDER_DESCRIPTOR;
  }

  repository(): GitProviderRepositoryPort {
    return this.repositoryPort;
  }

  health(): GitProviderHealthPort {
    return this.healthPort;
  }

  pullRequests() {
    return Effect.succeed(this.pullRequestsPort);
  }

  pullRequestReview() {
    return Effect.succeed(this.pullRequestReviewPort);
  }
}
