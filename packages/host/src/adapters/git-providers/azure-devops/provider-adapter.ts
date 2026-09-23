import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  type AzureDevOpsRepository,
  type GitProviderDescriptor,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../../ports/azure-area-paths-port";
import type { GitPort } from "../../../ports/git-port";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  IssueReaderPort,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import { createAzureDevOpsHealthPort } from "./health";
import { createAzureDevOpsAreaPathsReader, createAzureDevOpsIssueReader } from "./issues";
import { createAzureDevOpsPullRequestPort } from "./pull-requests";
import { createAzureDevOpsRepositoryAdapter } from "./repository";
import { createAzureDevOpsRestClient, type AzureDevOpsFetch } from "./rest-client";
import { createAzureDevOpsReviewPort } from "./review";

export class AzureDevOpsProviderAdapter implements GitProviderPort {
  private readonly connectionPort: AzureDevOpsConnectionPort;
  private readonly repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
  private readonly healthPort: GitProviderHealthPort;
  private readonly pullRequestsPort: PullRequestProviderPort;
  private readonly reviewPort: PullRequestReviewProviderPort;
  private readonly issueReaderPort: IssueReaderPort;
  private readonly areaPathsPort: AzureAreaPathsPort;

  constructor({
    connectionPort,
    fetchImplementation = fetch,
    gitPort,
  }: {
    connectionPort: AzureDevOpsConnectionPort;
    fetchImplementation?: AzureDevOpsFetch;
    gitPort: GitPort;
  }) {
    this.connectionPort = connectionPort;
    this.repositoryPort = createAzureDevOpsRepositoryAdapter({ gitPort });
    const client = createAzureDevOpsRestClient({
      connection: this.connectionPort,
      fetchImplementation,
    });
    this.healthPort = createAzureDevOpsHealthPort({
      client,
      connection: this.connectionPort,
      repositoryPort: this.repositoryPort,
    });
    this.pullRequestsPort = createAzureDevOpsPullRequestPort({
      client,
      repositoryPort: this.repositoryPort,
    });
    this.reviewPort = createAzureDevOpsReviewPort({ client, repositoryPort: this.repositoryPort });
    this.issueReaderPort = createAzureDevOpsIssueReader({
      client,
      repositoryPort: this.repositoryPort,
    });
    this.areaPathsPort = createAzureDevOpsAreaPathsReader({
      client,
      repositoryPort: this.repositoryPort,
    });
  }

  getDescriptor(): GitProviderDescriptor {
    return AZURE_DEVOPS_PROVIDER_DESCRIPTOR;
  }

  repository(): GitProviderRepositoryPort<AzureDevOpsRepository> {
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

  areaPaths(): AzureAreaPathsPort {
    return this.areaPathsPort;
  }

  connection(): AzureDevOpsConnectionPort {
    return this.connectionPort;
  }
}
