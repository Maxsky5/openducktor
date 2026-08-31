import type {
  GitProviderDescriptor,
  GitProviderHealth,
  GitProviderRepository,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderCapabilityError, GitProviderRepositoryError } from "./git-provider-errors";
import type { PullRequestReviewProviderPort } from "./pull-request-review-provider-port";

export type GitProviderRepositoryContext = {
  repository: GitProviderRepository;
  remoteName: string;
};

export type GitProviderRepositoryPort = {
  detectRepository(
    repoPath: string,
  ): Effect.Effect<GitProviderRepository, HostError | GitProviderRepositoryError>;
  getReadRepository(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderRepository, HostError | GitProviderRepositoryError>;
  getMappedRepositoryContext(
    repoConfig: RepoConfig,
  ): Effect.Effect<GitProviderRepositoryContext, HostError | GitProviderRepositoryError>;
};

export type GitProviderHealthPort = {
  getStatus(repoConfig: RepoConfig): Effect.Effect<GitProviderHealth, HostError>;
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
