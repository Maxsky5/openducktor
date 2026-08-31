import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderDescriptor,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  findGithubPullRequestForBranch,
  fetchGithubPullRequestByNumber,
  type GithubCommandDependencies,
  upsertGithubPullRequest,
} from "../../application/tasks/support/github-pull-requests";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import { GitProviderRepositoryError } from "../../ports/git-provider-errors";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../ports/pull-request-review-provider-port";
import { createGithubPullRequestReviewAdapter } from "../pull-requests/github/github-pull-request-review-adapter";
import { createGithubProviderHealthPort } from "./github-provider-health";
import { createGithubProviderRepositoryAdapter } from "./github-provider-repository";

const toPullRequestError = (cause: HostError | GitProviderRepositoryError): HostError =>
  cause instanceof GitProviderRepositoryError
    ? new HostValidationError({
        field: "git.provider.repository",
        message: cause.message,
        cause,
        details: {
          reason: cause.reason,
          repoPath: cause.repoPath,
          remoteNames: cause.remoteNames,
        },
      })
    : cause;

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
    const repositoryAdapter = createGithubProviderRepositoryAdapter({
      githubDependencies,
      gitPort,
    });
    const getRepository = (repoConfig: RepoConfig) =>
      repositoryAdapter.port.getRepository(repoConfig).pipe(Effect.mapError(toPullRequestError));
    const getMapping = (repoConfig: RepoConfig) =>
      repositoryAdapter.port.getMapping(repoConfig).pipe(Effect.mapError(toPullRequestError));

    this.repositoryPort = repositoryAdapter.port;
    this.healthPort = createGithubProviderHealthPort({
      githubDependencies,
      matchRemote: repositoryAdapter.matchRemote,
    });
    this.pullRequestsPort = {
      findByBranch: (input) =>
        Effect.gen(function* () {
          const repository = yield* getRepository(input.repoConfig);
          const pullRequest = yield* findGithubPullRequestForBranch(
            githubDependencies,
            input.repoConfig.repoPath,
            repository,
            input.sourceBranch,
            input.state,
          );
          return pullRequest?.record;
        }),
      getByNumber: (input) =>
        Effect.gen(function* () {
          const repository = yield* getRepository(input.repoConfig);
          const pullRequest = yield* fetchGithubPullRequestByNumber(
            githubDependencies,
            input.repoConfig.repoPath,
            repository,
            input.number,
          );
          return pullRequest.record;
        }),
      upsert: (input) =>
        Effect.gen(function* () {
          const context = yield* getMapping(input.repoConfig);
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
    this.pullRequestReviewPort = createGithubPullRequestReviewAdapter({
      githubDependencies,
      getRepository,
    });
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
