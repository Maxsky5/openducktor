import {
  GITLAB_PROVIDER_DESCRIPTOR,
  type GitProviderDescriptor,
  type GitlabRepository,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitPort } from "../../../ports/git-port";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  IssueReaderPort,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import type { GitlabConnectionPort } from "../../../ports/gitlab-connection-port";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import { createGitlabHealthPort } from "./health";
import type { GitlabHttp } from "./http";
import { createGitlabIssueReader } from "./issues";
import { createGitlabPullRequestPort } from "./pull-requests";
import { createGitlabRepositoryAdapter } from "./repository";
import { createGitlabRestClient } from "./rest-client";
import { createGitlabReviewPort } from "./review";

export class GitlabProviderAdapter implements GitProviderPort {
  private readonly repositoryPort: GitProviderRepositoryPort<GitlabRepository>;
  private readonly healthPort: GitProviderHealthPort;
  private readonly pullRequestsPort: PullRequestProviderPort;
  private readonly reviewPort: PullRequestReviewProviderPort;
  private readonly issueReaderPort: IssueReaderPort;

  constructor({
    connection,
    http,
    gitPort,
  }: {
    connection: GitlabConnectionPort;
    http: GitlabHttp;
    gitPort: GitPort;
  }) {
    this.repositoryPort = createGitlabRepositoryAdapter({ gitPort, connection });
    const client = createGitlabRestClient({ http, connection });
    this.healthPort = createGitlabHealthPort({ connection, repositoryPort: this.repositoryPort });
    this.pullRequestsPort = createGitlabPullRequestPort({
      client,
      repositoryPort: this.repositoryPort,
    });
    this.reviewPort = createGitlabReviewPort({ client });
    this.issueReaderPort = createGitlabIssueReader({ client });
  }

  getDescriptor(): GitProviderDescriptor {
    return GITLAB_PROVIDER_DESCRIPTOR;
  }

  repository(): GitProviderRepositoryPort<GitlabRepository> {
    return this.repositoryPort;
  }

  health(): GitProviderHealthPort {
    return this.healthPort;
  }

  pullRequests() {
    return Effect.succeed(this.pullRequestsPort);
  }

  pullRequestReview() {
    return Effect.succeed(this.reviewPort);
  }

  issues() {
    return Effect.succeed(this.issueReaderPort);
  }
}
