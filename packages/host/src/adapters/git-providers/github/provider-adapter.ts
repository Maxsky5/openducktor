import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderDescriptor,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  findGithubPullRequestForBranch,
  fetchGithubPullRequestByNumber,
  upsertGithubPullRequest,
} from "./pull-requests";
import type { GitPort } from "../../../ports/git-port";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../../ports/tool-discovery-port";
import { createGithubCli } from "./cli";
import { createGithubProviderHealthPort } from "./health";
import { createGithubPullRequestReviewAdapter } from "./review/adapter";
import { createGithubProviderRepositoryAdapter } from "./repository";

export class GithubProviderAdapter implements GitProviderPort {
  private readonly repositoryPort: GitProviderRepositoryPort;
  private readonly healthPort: GitProviderHealthPort;
  private readonly pullRequestsPort: PullRequestProviderPort;
  private readonly pullRequestReviewPort: PullRequestReviewProviderPort;

  constructor({
    gitPort,
    systemCommands,
    toolDiscovery,
  }: {
    gitPort: GitPort;
    systemCommands: SystemCommandPort;
    toolDiscovery: ToolDiscoveryPort;
  }) {
    const githubCli = createGithubCli({ systemCommands, toolDiscovery });
    const repositoryPort = createGithubProviderRepositoryAdapter({
      gitPort,
    });
    const getRepository = (repoConfig: RepoConfig) => repositoryPort.getRepository(repoConfig);
    const getMapping = (repoConfig: RepoConfig) => repositoryPort.getMapping(repoConfig);

    this.repositoryPort = repositoryPort;
    this.healthPort = createGithubProviderHealthPort({
      githubCli,
      repositoryPort,
    });
    this.pullRequestsPort = {
      findByBranch: (input) =>
        Effect.gen(function* () {
          const { repository } = yield* getMapping(input.repoConfig);
          const pullRequest = yield* findGithubPullRequestForBranch(
            githubCli,
            input.repoConfig.repoPath,
            repository,
            input.sourceBranch,
            input.state,
          );
          return pullRequest;
        }),
      getByNumber: (input) =>
        Effect.gen(function* () {
          const { repository } = yield* getMapping(input.repoConfig);
          const pullRequest = yield* fetchGithubPullRequestByNumber(
            githubCli,
            input.repoConfig.repoPath,
            repository,
            input.number,
          );
          return pullRequest;
        }),
      upsert: (input) =>
        Effect.gen(function* () {
          const context = yield* getMapping(input.repoConfig);
          return yield* upsertGithubPullRequest(
            githubCli,
            input.repoConfig.repoPath,
            context,
            input.approval,
            input.title,
            input.body,
          );
        }),
    };
    this.pullRequestReviewPort = createGithubPullRequestReviewAdapter({
      githubCli,
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
