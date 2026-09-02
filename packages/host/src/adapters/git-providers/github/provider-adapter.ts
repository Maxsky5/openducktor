import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderDescriptor,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
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
import { createGithubPullRequestProviderPort } from "./pull-requests";
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

    this.repositoryPort = repositoryPort;
    this.healthPort = createGithubProviderHealthPort({
      githubCli,
      repositoryPort,
    });
    this.pullRequestsPort = createGithubPullRequestProviderPort({
      githubCli,
      repositoryPort,
    });
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
