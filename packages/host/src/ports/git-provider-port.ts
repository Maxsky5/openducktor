import type {
  GitProviderAvailability,
  GitProviderDescriptor,
  GitProviderRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../effect/host-errors";
import type { GitPortError } from "./git-port";
import type { GitProviderCapabilityError } from "./git-provider-errors";
import type { PullRequestReviewProviderPort } from "./pull-request-review-provider-port";
import type { ToolDiscoveryError } from "./tool-discovery-port";

export type GitProviderOperationError =
  | GitPortError
  | HostValidationErrorAggregate
  | ToolDiscoveryError;

export type GitProviderRepositoryContext = {
  repository: GitProviderRepository;
  remoteName: string;
};

export type GitProviderRepositoryPort = {
  getReadRepository(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderRepository, GitProviderOperationError>;
  getWriteContext(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderRepositoryContext, GitProviderOperationError>;
};

export type GitProviderHealthPort = {
  getStatus(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderAvailability, GitProviderOperationError>;
};

export type PullRequestProviderInput = {
  repoConfig: RepoConfig;
};

export type FindPullRequestByBranchInput = PullRequestProviderInput & {
  sourceBranch: string;
  state: "open" | "all";
};

export type GetPullRequestByNumberInput = PullRequestProviderInput & {
  number: number;
};

export type UpsertPullRequestInput = PullRequestProviderInput & {
  approval: TaskApprovalContext;
  title: string;
  body: string;
};

export type PullRequestProviderPort = {
  findByBranch(
    input: FindPullRequestByBranchInput,
  ): Effect.Effect<PullRequest | undefined, GitProviderOperationError>;
  getByNumber(
    input: GetPullRequestByNumberInput,
  ): Effect.Effect<PullRequest, GitProviderOperationError>;
  upsert(input: UpsertPullRequestInput): Effect.Effect<PullRequest, GitProviderOperationError>;
};

export type GitProviderPort = {
  getDescriptor(): GitProviderDescriptor;
  repository(): GitProviderRepositoryPort;
  health(): GitProviderHealthPort;
  pullRequests(): Effect.Effect<PullRequestProviderPort, GitProviderCapabilityError>;
  pullRequestReview(): Effect.Effect<PullRequestReviewProviderPort, GitProviderCapabilityError>;
};
