import {
  AZURE_DEVOPS_PROVIDER_DESCRIPTOR,
  type AzureDevOpsRepository,
  type GitProviderDescriptor,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type { GitPort } from "../../../ports/git-port";
import type {
  GitProviderHealthPort,
  GitProviderPort,
  GitProviderRepositoryPort,
  PullRequestProviderPort,
} from "../../../ports/git-provider-port";
import type { PullRequestReviewProviderPort } from "../../../ports/pull-request-review-provider-port";
import { createAzureDevOpsHealthPort } from "./health";
import { createAzureDevOpsPullRequestPort } from "./pull-requests";
import { createAzureDevOpsRepositoryAdapter } from "./repository";
import { createAzureDevOpsRestClient } from "./rest-client";
import { createAzureDevOpsReviewPort } from "./review";

export class AzureDevOpsProviderAdapter implements GitProviderPort {
  private readonly connectionPort: AzureDevOpsConnectionPort;
  private readonly repositoryPort: GitProviderRepositoryPort<AzureDevOpsRepository>;
  private readonly healthPort: GitProviderHealthPort;
  private readonly pullRequestsPort: PullRequestProviderPort;
  private readonly reviewPort: PullRequestReviewProviderPort;

  constructor({
    connectionPort,
    gitPort,
  }: {
    connectionPort: AzureDevOpsConnectionPort;
    gitPort: GitPort;
  }) {
    this.connectionPort = connectionPort;
    this.repositoryPort = createAzureDevOpsRepositoryAdapter({ gitPort });
    const client = createAzureDevOpsRestClient({ connection: this.connectionPort });
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

  connection(): AzureDevOpsConnectionPort {
    return this.connectionPort;
  }
}
