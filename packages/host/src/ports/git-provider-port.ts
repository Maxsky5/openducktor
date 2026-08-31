import type {
  GitProviderAvailability,
  GitProviderDescriptor,
  GitProviderRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderCapabilityError } from "./git-provider-errors";
import type { PullRequestReviewProviderPort } from "./pull-request-review-provider-port";

export type GitProviderRepositoryContext = {
  repository: GitProviderRepository;
  remoteName: string;
};

export type GitProviderRepositoryPort = {
  getReadRepository(repoConfig: RepoConfig): Effect.Effect<GitProviderRepository, HostError>;
  getWriteContext(repoConfig: RepoConfig): Effect.Effect<GitProviderRepositoryContext, HostError>;
};

export type GitProviderHealthPort = {
  getStatus(repoConfig: RepoConfig): Effect.Effect<GitProviderAvailability, HostError>;
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
  ): Effect.Effect<PullRequest | undefined, HostError>;
  getByNumber(input: GetPullRequestByNumberInput): Effect.Effect<PullRequest, HostError>;
  upsert(input: UpsertPullRequestInput): Effect.Effect<PullRequest, HostError>;
};

export type GitProviderPort = {
  getDescriptor(): GitProviderDescriptor;
  repository(): GitProviderRepositoryPort;
  health(): GitProviderHealthPort;
  pullRequests(): Effect.Effect<PullRequestProviderPort, GitProviderCapabilityError>;
  pullRequestReview(): Effect.Effect<PullRequestReviewProviderPort, GitProviderCapabilityError>;
};
