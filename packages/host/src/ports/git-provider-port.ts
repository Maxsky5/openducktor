import type {
  GitProviderDescriptor,
  IssueImageGetResult,
  GitProviderHealth,
  GitProviderId,
  GitProviderRepository,
  SourceIssue,
  PullRequest,
  RepoConfig,
  TaskApprovalContext,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderCapabilityError, GitProviderRepositoryError } from "./git-provider-errors";
import type { PullRequestReviewProviderPort } from "./pull-request-review-provider-port";

export type GitProviderRepositoryMapping<
  Repository extends GitProviderRepository = GitProviderRepository,
> = {
  repository: Repository;
  remoteName: string;
};

export type GitProviderRepositoryPort<
  Repository extends GitProviderRepository = GitProviderRepository,
> = {
  detectRepository(
    repoPath: string,
  ): Effect.Effect<Repository, HostError | GitProviderRepositoryError>;
  getRepository(
    repoConfig: RepoConfig,
  ): Effect.Effect<Repository, HostError | GitProviderRepositoryError>;
  getMapping(
    repoConfig: RepoConfig,
  ): Effect.Effect<
    GitProviderRepositoryMapping<Repository>,
    HostError | GitProviderRepositoryError
  >;
};

export type GitProviderHealthPort = {
  getStatus(repoConfig: RepoConfig): Effect.Effect<GitProviderHealth, HostError>;
};

export type PullRequestProviderInput = {
  repoConfig: RepoConfig;
};

export type ProviderPullRequest = {
  record: PullRequest;
  sourceBranch: string;
  targetBranch: string;
};

export type PullRequestBranchInput = PullRequestProviderInput & {
  sourceBranch: string;
};

export type GetPullRequestByNumberInput = PullRequestProviderInput & {
  number: number;
};

export type UpsertPullRequestInput = PullRequestProviderInput & {
  approval: TaskApprovalContext;
  title: string;
  body: string;
};

export type RefreshPullRequestInput = PullRequestProviderInput & {
  linkedPullRequest: PullRequest;
};

export type PullRequestProviderPort = {
  providerId: GitProviderId;
  findOpenForSourceBranch(
    input: PullRequestBranchInput,
  ): Effect.Effect<ProviderPullRequest | undefined, HostError | GitProviderRepositoryError>;
  findLatestMergedForSourceBranch(
    input: PullRequestBranchInput,
  ): Effect.Effect<ProviderPullRequest | undefined, HostError | GitProviderRepositoryError>;
  getByNumber(
    input: GetPullRequestByNumberInput,
  ): Effect.Effect<ProviderPullRequest, HostError | GitProviderRepositoryError>;
  refresh(
    input: RefreshPullRequestInput,
  ): Effect.Effect<ProviderPullRequest, HostError | GitProviderRepositoryError>;
  resolvePublishRemote(
    input: PullRequestProviderInput,
  ): Effect.Effect<string, HostError | GitProviderRepositoryError>;
  upsert(
    input: UpsertPullRequestInput,
  ): Effect.Effect<PullRequest, HostError | GitProviderRepositoryError>;
};

export type IssueReaderPort = {
  providerId: GitProviderId;
  scope(repoConfig: RepoConfig): Effect.Effect<string, HostError | GitProviderRepositoryError>;
  list(input: {
    repoConfig: RepoConfig;
    search: string;
    page: number;
    snapshot?: string;
  }): Effect.Effect<
    {
      items: SourceIssue[];
      nextPage?: number | undefined;
      snapshot?: string;
      incompleteResults?: boolean;
    },
    HostError | GitProviderRepositoryError
  >;
  get(input: {
    repoConfig: RepoConfig;
    sourceId: string;
  }): Effect.Effect<SourceIssue, HostError | GitProviderRepositoryError>;
  prepareGet(
    repoConfig: RepoConfig,
  ): Effect.Effect<
    (sourceId: string) => Effect.Effect<SourceIssue, HostError | GitProviderRepositoryError>,
    HostError | GitProviderRepositoryError
  >;
  readImage?(input: {
    repoConfig: RepoConfig;
    sourceId: string;
    url: string;
  }): Effect.Effect<IssueImageGetResult, HostError | GitProviderRepositoryError>;
};

export type GitProviderPort = {
  getDescriptor(): GitProviderDescriptor;
  repository(): GitProviderRepositoryPort;
  health(): GitProviderHealthPort;
  pullRequests(): Effect.Effect<PullRequestProviderPort, GitProviderCapabilityError>;
  pullRequestReview(): Effect.Effect<PullRequestReviewProviderPort, GitProviderCapabilityError>;
  issues(): Effect.Effect<IssueReaderPort, GitProviderCapabilityError>;
};
